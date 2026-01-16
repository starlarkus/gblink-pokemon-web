
export class UsbConnection {
    constructor() {
        this.device = null;
        this.interfaceNumber = 0;
        this.endpointIn = 0;
        this.endpointOut = 0;
        this.isConnected = false;
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
            
            this.device = await navigator.usb.requestDevice({ filters: filters });
            await this.device.open();

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
