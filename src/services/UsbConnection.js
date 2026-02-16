
function fwVersionAtLeast(version, minMajor, minMinor, minPatch) {
    if (!version) return false;
    const parts = version.split('.').map(Number);
    const [major = 0, minor = 0, patch = 0] = parts;
    if (major !== minMajor) return major > minMajor;
    if (minor !== minMinor) return minor > minMinor;
    return patch >= minPatch;
}

// Voltage switch magic packets (36 bytes: 32-byte prefix + 4-byte command)
const VSWITCH_PREFIX = new Uint8Array([
    0xCA, 0xFE, 0xCA, 0xFE, 0xCA, 0xFE, 0xCA, 0xFE,
    0xCA, 0xFE, 0xCA, 0xFE, 0xCA, 0xFE, 0xCA, 0xFE,
    0xDE, 0xAD, 0xBE, 0xEF, 0xDE, 0xAD, 0xBE, 0xEF,
    0xDE, 0xAD, 0xBE, 0xEF, 0xDE, 0xAD, 0xBE, 0xEF
]);

function buildVswitchPacket(suffix) {
    const packet = new Uint8Array(36);
    packet.set(VSWITCH_PREFIX);
    packet.set(new TextEncoder().encode(suffix), 32);
    return packet;
}

const VSWITCH_3V3_PACKET = buildVswitchPacket('V3V3');
const VSWITCH_5V_PACKET = buildVswitchPacket('V5V0');

// LED magic packet: 32-byte prefix + "LEDS" + R, G, B, on/off = 40 bytes
const LED_PREFIX = new Uint8Array([
    0xCA, 0xFE, 0xCA, 0xFE, 0xCA, 0xFE, 0xCA, 0xFE,
    0xCA, 0xFE, 0xCA, 0xFE, 0xCA, 0xFE, 0xCA, 0xFE,
    0xDE, 0xAD, 0xBE, 0xEF, 0xDE, 0xAD, 0xBE, 0xEF,
    0xDE, 0xAD, 0xBE, 0xEF, 0xDE, 0xAD, 0xBE, 0xEF,
    0x4C, 0x45, 0x44, 0x53  // "LEDS"
]);

function buildLedPacket(r, g, b, on) {
    const packet = new Uint8Array(40);
    packet.set(LED_PREFIX);
    packet[36] = r;
    packet[37] = g;
    packet[38] = b;
    packet[39] = on ? 1 : 0;
    return packet;
}

export class UsbConnection {
    constructor() {
        this.device = null;
        this.interfaceNumber = 0;
        this.endpointIn = 0;
        this.endpointOut = 0;
        this.isConnected = false;
        this.firmwareVersion = null;
    }

    async connect() {
        try {
            const filters = [
                { vendorId: 0xcafe }, // TinyUSB example / GB Link Adapter
                { vendorId: 0x239A }  // Adafruit boards
            ];

            if (!navigator.usb) {
                throw new Error("WebUSB is not supported in this browser. Please use Chrome or Edge.");
            }

            // Clean up any previously paired devices that may be in a stale state
            // (e.g., from a page refresh without unplugging)
            try {
                const existingDevices = await navigator.usb.getDevices();
                for (const dev of existingDevices) {
                    if (dev.opened) {
                        console.log("Found stale device, closing...");
                        try {
                            await dev.close();
                        } catch (e) {
                            console.log("Could not close stale device:", e);
                        }
                    }
                }
            } catch (e) {
                console.log("Cleanup error:", e);
            }

            this.device = await navigator.usb.requestDevice({ filters: filters });
            await this.device.open();

            // Fix for stale connections on refresh
            if (this.device.reset) {
                await this.device.reset().catch(e => {
                    console.warn("Device reset failed (non-fatal):", e);
                });
            }

            // Select configuration
            await this.device.selectConfiguration(1);

            // Find interface and endpoints
            const interfaces = this.device.configuration.interfaces;
            let foundInterface = false;

            for (const element of interfaces) {
                for (const elementalt of element.alternates) {
                    if (elementalt.interfaceClass === 0xFF) {
                        this.interfaceNumber = element.interfaceNumber;

                        for (const endpoint of elementalt.endpoints) {
                            if (endpoint.direction === "out") {
                                this.endpointOut = endpoint.endpointNumber;
                            }
                            if (endpoint.direction === "in") {
                                this.endpointIn = endpoint.endpointNumber;
                            }
                        }
                        foundInterface = true;
                    }
                }
            }

            if (!foundInterface) {
                throw new Error("Could not find compatible interface (Class 0xFF)");
            }

            await this.device.claimInterface(this.interfaceNumber);
            await this.device.selectAlternateInterface(this.interfaceNumber, 0);

            // Initialize connection (Control Transfer)
            // Request 0x22, Value 0x01 is specific to the GB Link firmware initialization
            await this.device.controlTransferOut({
                requestType: 'class',
                recipient: 'interface',
                request: 0x22,
                value: 0x01,
                index: this.interfaceNumber
            });

            this.isConnected = true;

            // Read firmware version string (new firmware sends "GBLINK:x.x.x\n" on connect)
            try {
                const result = await Promise.race([
                    this.device.transferIn(this.endpointIn, 64),
                    new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 500))
                ]);
                if (result.status === 'ok' && result.data && result.data.byteLength > 0) {
                    const str = new TextDecoder().decode(result.data);
                    if (str.startsWith('GBLINK:')) {
                        this.firmwareVersion = str.trim().substring(7);
                        console.log("Firmware version:", this.firmwareVersion);
                    }
                }
            } catch (e) {
                console.log("No firmware version (old firmware)");
            }

            console.log("USB Connection established");
            return true;

        } catch (error) {
            console.error("USB Connection failed:", error);
            this.isConnected = false;
            throw error;
        }
    }

    async disconnect() {
        if (this.device) {
            await this.device.close();
        }
        this.device = null;
        this.isConnected = false;
    }

    async readByte() {
        if (!this.isConnected) throw new Error("Not connected");

        // Read 64 bytes (max packet size) but we usually only care about the first one for single byte transfers
        // The firmware might return more.
        const result = await this.device.transferIn(this.endpointIn, 64);

        if (result.status === 'ok' && result.data.byteLength > 0) {
            return result.data.getUint8(0);
        }
        throw new Error("Read failed or empty");
    }

    async readBytes(length) {
        if (!this.isConnected) throw new Error("Not connected");
        const result = await this.device.transferIn(this.endpointIn, length);
        if (result.status === 'ok') {
            return new Uint8Array(result.data.buffer);
        }
        throw new Error("Read failed");
    }

    async writeByte(byte) {
        if (!this.isConnected) throw new Error("Not connected");
        const data = new Uint8Array([byte]);
        await this.device.transferOut(this.endpointOut, data);
    }

    async writeBytes(bytes) {
        if (!this.isConnected) throw new Error("Not connected");
        // Ensure bytes is a Uint8Array
        const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        await this.device.transferOut(this.endpointOut, data);
    }

    async setVoltage(mode) {
        if (!this.isConnected || !fwVersionAtLeast(this.firmwareVersion, 1, 0, 6)) return false;
        const packet = mode === '5v' ? VSWITCH_5V_PACKET : VSWITCH_3V3_PACKET;
        await this.device.transferOut(this.endpointOut, packet);
        // Read ack byte
        try {
            await Promise.race([
                this.device.transferIn(this.endpointIn, 64),
                new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 500))
            ]);
        } catch (e) { /* ack timeout is non-fatal */ }
        console.log(`Voltage switched to ${mode}`);
        return true;
    }

    async setLed(r, g, b, on = true) {
        if (!this.isConnected || !fwVersionAtLeast(this.firmwareVersion, 1, 0, 6)) return false;
        const packet = buildLedPacket(r, g, b, on);
        await this.device.transferOut(this.endpointOut, packet);
        try {
            await Promise.race([
                this.device.transferIn(this.endpointIn, 64),
                new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 500))
            ]);
        } catch (e) { /* ack timeout is non-fatal */ }
        return true;
    }

    async readBytesRaw(length = 64, timeoutMs = 100) {
        if (!this.isConnected) throw new Error("Not connected");
        try {
            const result = await Promise.race([
                this.device.transferIn(this.endpointIn, length),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error("Read timeout")), timeoutMs)
                )
            ]);
            if (result.status === 'ok' && result.data && result.data.byteLength > 0) {
                return new Uint8Array(result.data.buffer);
            }
        } catch (e) {
            // Timeout or no data - return empty
        }
        return new Uint8Array(0);
    }
}
