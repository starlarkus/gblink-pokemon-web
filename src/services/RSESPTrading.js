
import { TradingProtocol } from './TradingProtocol.js';
import { RSESPUtils, RSESPTradingPokemonInfo, RSESPTradingData } from './RSESPUtils.js';
import { RSESPChecks } from './RSESPChecks.js';

export class RSESPTrading extends TradingProtocol {
    constructor(usb, ws, logger, tradeType = 'pool', isBuffered = false, doSanityChecks = true, options = {}) {
        super(usb, ws, logger);

        this.checks = new RSESPChecks(doSanityChecks);

        this.tradeType = tradeType;

        // Gen 3 Constants matches Python RSESPTrading
        this.full_transfer = "FL3S";
        this.pool_transfer = "P3SI";
        this.pool_transfer_out = "P3SO";
        this.choice_transfer = "CH3S";
        this.accept_transfer = ["A3S1", "A3S2"];
        this.success_transfer = ["S3S1", "S3S2", "S3S3", "S3S4", "S3S5", "S3S6", "S3S7"];

        this.special_sections_len = [0x380]; // 896 bytes

        // Protocol Control Flags
        this.done_control_flag = 0x20;
        this.not_done_control_flag = 0x40;
        this.sending_data_control_flag = 0x10;
        this.in_party_trading_flag = 0x80;
        this.asking_data_nybble = 0xC;

        this.trade_offer_start = 0x80;
        this.trade_cancel = 0x8F;
        this.stop_trade_val = (this.trade_cancel << 16);
        this.first_trade_index = (this.trade_offer_start << 16);

        this.base_send_data_start = 1;
        this.base_data_chunk_size = 0xFE;
        this.since_last_useful_limit = 10;

        this.accept_trade = [0xA2, 0xB2];
        this.decline_trade = [0xA1, 0xB1];
        this.success_trade = [0x90, 0x91, 0x92, 0x93, 0x94, 0x95, 0x9C];
        this.failed_trade = 0x9F;

        // 32-bit SPI helper
        this.exchange32Bit = async (val) => {
            // Write 4 bytes (Big Endian logic in multboot, but let's check Python)
            // Python: spi_proto.c implementation usually handles endianness. 
            // The python script doesn't show the SPI low level, but Multiboot.js used Big Endian for length/CRC??
            // Wait, Multiboot.js `Spi32` writes: val >>> 24, val >>> 16, ... (Big Endian transmission)
            // And reads Big Endian.
            // The GBA hardware Serial is usually Little Endian for data? 
            // In normal 32-bit mode (SI/SO/SD/SC), it shifts out MSB first usually?
            // Actually, GBA normal serial is 8-bit or 32-bit.
            // Multiboot.js uses `Spi32` that sends MSB first.
            // Let's stick to what Multiboot.js does since it works for Multiboot.

            // Multiboot Spi32 implementation reference:
            const tx = new Uint8Array([
                (val >>> 24) & 0xFF,
                (val >>> 16) & 0xFF,
                (val >>> 8) & 0xFF,
                val & 0xFF
            ]);
            await this.usb.writeBytes(tx);
            const rx = await this.usb.readBytesRaw(4);
            if (!rx || rx.length < 4) return 0;
            return ((rx[0] << 24) | (rx[1] << 16) | (rx[2] << 8) | rx[3]) >>> 0;
        };
    }

    async startTrade() {
        this.log("Starting Gen 3 Trade...");

        if (this.tradeType === 'pool') {
            await this.poolTradeLoop();
        } else {
            this.log("Only Pool Trading is supported for Gen 3 currently.");
        }
    }

    // === Low Level Protocol Helpers (Ported from Python) ===

    swapByte(data) {
        // Python swap_byte seems to just wrap the exchange.
        // But wait, the Python `swap_byte` in `rse_sp_trading.py` calls `self.connection.exchange_32_bit(data)`?
        // Actually `GSCTrading` base class has `swap_byte` which does 8-bit.
        // `RSESPTrading` overrides `swap_trade_setup_data`, etc. to working with 32-bit logic.
        // We will assume `exchange32Bit` is the primitive.
        return this.exchange32Bit(data);
    }

    // ... Utility functions for packing/unpacking 32-bit Control/Data packets ...

    getBytesFromPos(index) {
        let base_pos = index & 0xFFF;
        let byte_base = this.base_send_data_start;
        while (base_pos >= this.base_data_chunk_size) {
            base_pos -= this.base_data_chunk_size;
            byte_base += 1;
        }
        return (byte_base << 8) | base_pos;
    }

    getPosFromBytes(value) {
        let final_pos = value & 0xFF;
        if (final_pos >= this.base_data_chunk_size) {
            final_pos = 0;
        }
        return final_pos + (this.base_data_chunk_size * (((value >>> 8) & 0xF) - this.base_send_data_start));
    }

    async swapTradeSetupData(next, index, is_complete) {
        let data = next;
        if (is_complete) {
            data |= (this.done_control_flag << 24);
        } else {
            data |= (this.not_done_control_flag << 24);
        }
        data |= (this.sending_data_control_flag << 24);
        data |= (this.getBytesFromPos(index) << 16);
        data |= (next & 0xFFFF);

        // Need to handle signed integers behavior in JS? bitwise ops are 32-bit signed.
        // >>> 0 ensures unsigned.
        data = data >>> 0;

        const received = await this.swapByte(data);
        return this.interpretInDataSetupGen3(received);
    }

    async askTradeSetupData(start, end) {
        let data = 0;
        data |= ((this.not_done_control_flag | this.asking_data_nybble) << 24);
        data |= (start & 0xFFF);
        data |= ((end & 0xFFF) << 12);

        data = data >>> 0;

        const received = await this.swapByte(data);
        return this.interpretInDataSetupGen3(received);
    }

    interpretInDataSetupGen3(data) {
        let next = data & 0xFFFF;
        let position = (data >>> 16) & 0xFF;
        let control_byte = (data >>> 24) & 0xFF;
        let other_pos_gen3 = data & 0xFFF;
        let other_end_gen3 = (data >>> 12) & 0xFFF;

        let is_valid = false;
        let is_asking = false;
        let is_complete = false;
        let is_done = false;

        if ((control_byte & 0xF) >= this.asking_data_nybble) {
            control_byte &= ~this.sending_data_control_flag;
            if ((control_byte & this.not_done_control_flag) !== 0) {
                is_asking = true;
                if (other_end_gen3 > (this.special_sections_len[0] >> 1)) {
                    other_end_gen3 = this.special_sections_len[0] >> 1;
                }
                if (other_pos_gen3 >= other_end_gen3) {
                    other_pos_gen3 = other_end_gen3;
                }
            } else if ((control_byte & this.done_control_flag) !== 0) {
                other_pos_gen3 = other_end_gen3;
            }
        }

        if ((control_byte & this.sending_data_control_flag) !== 0) {
            let recv_pos = this.getPosFromBytes(data >>> 16);
            position = recv_pos;
            is_valid = true;
            if (recv_pos >= (this.special_sections_len[0] >> 1)) {
                recv_pos = 0;
                control_byte &= ~this.sending_data_control_flag;
                is_valid = false;
            }
        }

        if ((control_byte & this.done_control_flag) !== 0) {
            is_done = true;
            if (control_byte & this.in_party_trading_flag) {
                is_complete = true;
            }
        }

        return { next, position, is_valid, is_asking, is_complete, is_done, other_pos_gen3, other_end_gen3 };
    }

    async swapTradeDataDump() {
        // (done | in_party) << 24
        let data = ((this.done_control_flag | this.in_party_trading_flag) << 24) >>> 0;
        const received = await this.swapByte(data);
        return this.interpretInDataTradeGen3(received);
    }

    async swapTradeOfferDataPure(in_data, is_cancel = false) {
        let data = ((this.done_control_flag | this.in_party_trading_flag) << 24);
        if (is_cancel) {
            data |= (this.trade_cancel << 16);
        } else {
            data |= in_data;
        }
        data = data >>> 0;
        const received = await this.swapByte(data);
        return this.interpretInDataTradeGen3(received);
    }

    async swapTradeRawDataPure(in_data) {
        let data = ((this.done_control_flag | this.in_party_trading_flag) << 24);
        data |= in_data;
        data = data >>> 0;
        const received = await this.swapByte(data);
        return this.interpretInDataTradeGen3(received);
    }

    interpretInDataTradeGen3(data) {
        if (!data) return null;
        let next = data & 0xFFFFFF;
        let control_byte = (data >>> 24) & 0xFF;

        if (control_byte !== (this.in_party_trading_flag | this.done_control_flag)) {
            return null;
        }
        return next;
    }

    findUncompletedRange(completed_data) {
        let max_size = 0;
        let max_start = 0;
        let max_end = 0;
        let i = 0;

        while (i < completed_data.length) {
            let k = i;
            // Find next completed block
            while (k < completed_data.length && !completed_data[k]) {
                k++;
            }
            // k is now the index of the first completed block after i, or length
            if (k - i > max_size) {
                max_size = k - i;
                max_start = i;
                max_end = k;
            }
            // Skip completed blocks
            while (k < completed_data.length && completed_data[k]) {
                k++;
            }
            i = k;
        }
        return [max_start, max_end];
    }

    // === Data Exchange Section ===

    async readSection(sendData) {
        const length = this.special_sections_len[0];
        const numBlocks = length / 2;
        const completedData = new Array(numBlocks).fill(false);
        const buf = new Uint8Array(length);

        let numUncompleted = numBlocks;
        let otherPos = 0;
        let otherEnd = 0;

        let next = 0;
        let sinceLastUseful = this.since_last_useful_limit;
        let transferSuccessful = false;
        let hasAllData = false;

        // Initial sync?
        // Python: self.sync_with_cable(self.not_done_control_flag|self.asking_data_nybble)

        while (!transferSuccessful) {
            if (sinceLastUseful >= this.since_last_useful_limit && !hasAllData) {
                const [start, end] = this.findUncompletedRange(completedData);
                const res = await this.askTradeSetupData(start, end);
                // Unwrap result
                next = res.next;
                // is_valid, etc. are part of res
                // Update state from Res?
                // actually askTradeSetupData updates logic is simplified in python,
                // it just sends the request.
                // The response handling is uniform.
                if (res.is_asking) {
                    otherPos = res.other_pos_gen3;
                    otherEnd = res.other_end_gen3;
                }
                sinceLastUseful = 0;
            } else {
                let nextToSend = 0;
                if (sendData && otherPos < otherEnd) {
                    nextToSend = (sendData[otherPos * 2]) | (sendData[otherPos * 2 + 1] << 8);
                }

                const res = await this.swapTradeSetupData(nextToSend, otherPos, hasAllData);
                next = res.next;
                const index = res.position;

                if (otherPos < otherEnd) {
                    otherPos++;
                }
                if (otherPos >= numBlocks) {
                    otherPos = 0;
                }

                if (res.is_asking) {
                    otherPos = res.other_pos_gen3;
                    otherEnd = res.other_end_gen3;
                } else if (!(res.is_done && res.is_complete)) {
                    if (!hasAllData && res.is_valid) {
                        // Check bounds
                        if (index < numBlocks) {
                            buf[index * 2] = next & 0xFF;
                            buf[index * 2 + 1] = (next >>> 8) & 0xFF;

                            if (!completedData[index]) {
                                sinceLastUseful = 0;
                                completedData[index] = true;
                                numUncompleted--;

                                // Progress log
                                if (numUncompleted % 50 === 0) {
                                    this.log(`Transferring: ${length - numUncompleted * 2}/${length}`);
                                }

                                if (numUncompleted === 0) {
                                    // Verify checksum?
                                    // Assuming simple checksum for now or just trust
                                    hasAllData = true;
                                    if (!sendData) {
                                        transferSuccessful = true;
                                    }
                                }
                            }
                        }
                    }
                } else {
                    if (hasAllData) {
                        transferSuccessful = true;
                    }
                }
            }
            sinceLastUseful++;
            await this.sleep(0); // Yield
        }

        return buf;
    }

    // === Pool Logic ===

    async poolTradeLoop() {
        this.log("Connecting to Pool Server...");
        // Ensure WS is connected
        if (!this.ws.isConnected) {
            this.log("WS not connected!");
            return;
        }

        while (!this.stopTrade) {
            // 1. Get Pool Data
            this.log("Requesting Pokemon from Pool...");
            let poolMon = null;

            this.ws.sendGetData(this.pool_transfer);
            const poolData = await this.waitForMessage(this.pool_transfer);

            // poolData is [Counter, Data...]
            // Check for valid data
            if (poolData.length <= 2) {
                this.log("Pool returned valid, but empty? Retrying...");
                continue;
            }

            // Parse Pool Mon
            const monDataRaw = poolData.slice(1); // Skip counter
            // Actually the python: mon = self.party_reader(GSCUtilsMisc.read_data(self.fileBaseTargetName), do_full=False)
            // It builds a party.
            // But here we can just create the Info object for the single mon to send.

            // The protocol exchanges the entire 896 byte structure (Party info)
            // But the Pool only sends one Pokemon.
            // We need to wrap it into a dummy party structure.
            // Or does readSection handle it?

            // Python: self.other_pokemon = self.party_reader(data_other)
            // data_other comes from read_section.

            // So we need to:
            // 1. Construct a dummy party containing the Pool's pokemon.
            // 2. Exchange that via `readSection` with the GBA.

            const poolMonInfo = new RSESPTradingPokemonInfo(monDataRaw, 0, 0x64, true); // Encrypted? Pool sends encrypted?
            // Python reference: received_mon = self.utils_class.single_mon_from_data(self.trader.checks, mon)
            // And then inserts into party.

            const dummyPartyData = this.createDummyParty(poolMonInfo);

            this.log("Starting Trade Sequence with GBA...");

            // Exchange Data
            // readSection returns [theirData, ourData (that we sent)]? 
            // In my JS port `readSection` returns the received data. 
            // It takes `sendData` as input.
            const receivedPartyData = await this.readSection(dummyPartyData);

            // Parse received party
            // We need to find which Pokemon the user selected
            // But that happens later in the menu loop.
            // Here we just got their party.

            // Now enter Trade Menu Loop
            await this.doTradeMenu(receivedPartyData, dummyPartyData);
        }
    }

    createDummyParty(monInfo) {
        // Create an 896-byte buffer representing a party with 1 pokemon (the pool mon)
        const buf = new Uint8Array(896);
        // Fill properly...
        // Header: Count (4 bytes)
        RSESPUtils.writeInt(buf, 0xE4, 1); // trading_party_info_pos

        // Pokemon Data
        const monData = monInfo.getData();
        // Copy to trading_pokemon_pos (0xE8)
        buf.set(monData.slice(0, 100), 0xE8);

        // Mail/Version/Ribbon need to be copied too if present

        // Calculate Checksums
        // Pass wrapped array for lengths as expected by generateChecksum
        RSESPTradingData.generateChecksum(buf, this.special_sections_len);

        return buf;
    }

    async doTradeMenu(receivedPartyData, sentPartyData) {
        // ... Implement the specific Choice/Accept/Success loop ...
        // See do_trade in Python
        this.log("Entering Trade Menu...");

        let tradeCompleted = false;

        while (!tradeCompleted && !this.stopTrade) {
            // Wait for Choice
            // For now, let's just log and loop to prove connection
            // We need to implement swapTradeOfferDataPure loop

            let sentMon = 0; // We are the server (Pool), we offer index 0 (the pool mon)
            // But in Python: sent_mon = self.wait_for_choice(0)
            // Wait, Python's `pool_trade`:
            // 1. `do_trade(..., to_server=True)`
            // 2. `sent_mon = self.wait_for_choice(0)` -> Gets what WE (Script) selected? 
            //    No, `wait_for_choice` reads from the GBA what the GBA selected?
            //    Actually `wait_for_choice` usually waits for the local user selection in UI apps.
            //    But here the script acts as the "Other Player".
            //    In `pool_trade`, `self.get_first_mon` is passed as `get_mon_function`.

            // The script sends ITS choice (Index 0, the pool mon).
            // It Receives the GBA's choice.

            // 1. Send our choice (Index 0 + Species)
            // 2. Receive GBA choice

            const myChoice = this.first_trade_index | 0; // Index 0? Need species too?
            // Python: `self.first_trade_index | self.other_pokemon.pokemon[0].get_species()`
            // `other_pokemon` in python context is the one from Pool.

            // Need to parse species from sentPartyData
            // ...

            await this.sleep(100);
            // Placeholder to break loop
            tradeCompleted = true;
        }

        this.log("Trade Menu Loop Finished (Placeholder)");
    }

    // Helper to wait for WS message (reused from GSCTrading or reimplemented)
    waitForMessage(type) {
        return new Promise((resolve) => {
            const check = () => {
                if (this.ws.recvDict[type]) {
                    const data = this.ws.recvDict[type];
                    delete this.ws.recvDict[type];
                    resolve(data);
                } else {
                    setTimeout(check, 100);
                }
            };
            check();
        });
    }
}
