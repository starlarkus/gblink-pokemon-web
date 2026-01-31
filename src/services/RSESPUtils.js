
import { GSCUtils } from './GSCUtils.js';
import { GSCPokemonInfo } from './GSCPokemonInfo.js';
import { GSCTradingData } from './GSCTradingDataUtils.js';

export class RSESPUtils extends GSCUtils {
    static init() {
        this.base_folder = "useful_data/rse/";
        this.invalid_held_items = null; // To be loaded
        this.invalid_pokemon = null;    // To be loaded
        this.abilities = null;          // To be loaded

        // Gen 3 constants
        this.last_valid_pokemon = 411;
        this.last_valid_item = 376;
        this.last_valid_move = 354;
        this.struggle_id = 165;

        // Personality value encryption positions
        this.enc_positions = this.init_enc_positions();
    }

    static init_enc_positions() {
        // Equivalent to Python's init_enc_positions
        // 0=Growth, 1=Attacks, 2=EVs, 3=Misc
        const positions = [];
        for (let i = 0; i < 4; i++) {
            for (let j = 0; j < 4; j++) {
                if (j !== i) {
                    for (let k = 0; k < 4; k++) {
                        if (k !== i && k !== j) {
                            for (let l = 0; l < 4; l++) {
                                if (l !== i && l !== j && l !== k) {
                                    positions.push((0 << (i * 2)) | (1 << (j * 2)) | (2 << (k * 2)) | (3 << (l * 2)));
                                }
                            }
                        }
                    }
                }
            }
        }
        return positions;
    }

    // Helper functions for reading/writing LE integers (similar to GSCUtilsMisc)
    static readInt(data, offset) {
        return (data[offset]) | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24);
    }

    static writeInt(data, offset, val) {
        data[offset] = val & 0xFF;
        data[offset + 1] = (val >>> 8) & 0xFF;
        data[offset + 2] = (val >>> 16) & 0xFF;
        data[offset + 3] = (val >>> 24) & 0xFF;
    }

    static readShort(data, offset) {
        return (data[offset]) | (data[offset + 1] << 8);
    }

    static writeShort(data, offset, val) {
        data[offset] = val & 0xFF;
        data[offset + 1] = (val >>> 8) & 0xFF;
    }
}

// Ensure init is called
RSESPUtils.init();

export class RSESPTradingPokemonInfo extends GSCPokemonInfo {
    constructor(data, start, length = 0x64, isEncrypted = true) {
        super(data, start, length);

        // Constants (override GSC defaults)
        this.pokemon_data_len = 0x64; // 100 bytes
        this.mail_len = 0x24;         // 36 bytes
        this.version_info_len = 2;
        this.ribbon_info_len = 11;

        // Offsets within the 100-byte structure
        this.pid_pos = 0;
        this.ot_id_pos = 4;
        this.nickname_pos = 8;
        this.language_pos = 18;
        this.use_egg_name_pos = 19;
        this.ot_name_pos = 20;
        this.checksum_pos = 28;
        this.enc_data_pos = 32;
        this.enc_data_len = 48;
        this.status_pos = 80;
        this.level_pos = 84;
        this.mail_info_pos = 85;
        this.curr_hp_pos = 86;
        this.stats_pos = 88;

        this.pid = RSESPUtils.readInt(this.values, this.pid_pos);
        this.ot_id = RSESPUtils.readInt(this.values, this.ot_id_pos);

        this.isValid = true;
        this.checksumFailed = false;

        this._precalced_lengths = [
            this.pokemon_data_len,
            this.mail_len,
            this.version_info_len,
            this.ribbon_info_len
        ];

        // Initialize defaults for separate sections
        this.version_info = new Uint8Array(this.version_info_len);
        this.ribbon_info = new Uint8Array(this.ribbon_info_len);

        if (isEncrypted) {
            this.decryptData();
        } else {
            // If passed unencrypted (e.g. constructing from scratch), we manually set substructures
            this.parseSubstructures();
        }
    }

    // Decrypt data logic
    decryptData() {
        const enc_data = this.values.slice(this.enc_data_pos, this.enc_data_pos + this.enc_data_len);
        const decrypted_data = new Uint8Array(this.enc_data_len);

        // Checksum verification
        let checksum = 0;

        // Decrypt 32-bit words
        for (let i = 0; i < this.enc_data_len / 4; i++) {
            let val = RSESPUtils.readInt(enc_data, i * 4);
            val ^= this.pid ^ this.ot_id;

            // Re-encode to bytes for checksum calculation (Python does it on the value)
            // Python: checksum = (checksum + single_entry_dec) & 0xFFFF ...
            // Wait, Python's checksum is on the 16-bit words of the UNENCRYPTED data?
            // "checksum = (checksum + single_entry_dec) & 0xFFFF" -> single_entry_dec is 32-bit.
            // "checksum = (checksum + (single_entry_dec>>16)) & 0xFFFF"
            // So it limits checksum to 16 bits.

            // Write decrypted word to temp buffer
            RSESPUtils.writeInt(decrypted_data, i * 4, val);

            // Checksum calc
            let wordLow = val & 0xFFFF;
            let wordHigh = (val >>> 16) & 0xFFFF;
            checksum = (checksum + wordLow) & 0xFFFF;
            checksum = (checksum + wordHigh) & 0xFFFF;
        }

        const storedChecksum = RSESPUtils.readShort(this.values, this.checksum_pos);
        if (checksum !== storedChecksum) {
            this.isValid = false;
            this.checksumFailed = true;
            // console.warn("Checksum failed!", checksum, storedChecksum);
        }

        // Unshuffle datablocks
        // Index determined by PID % 24
        const index = this.pid % 24; // 24 = len(enc_positions)
        const order = RSESPUtils.enc_positions[index];

        // 4 blocks of 12 bytes each (48 bytes total)
        // order is encoded as 2 bits per block index

        const growthIdx = (order >> 0) & 3;
        const attacksIdx = (order >> 2) & 3;
        const evsIdx = (order >> 4) & 3;
        const miscIdx = (order >> 6) & 3;

        const blockSize = 12; // 48 / 4

        this.growth = decrypted_data.slice(growthIdx * blockSize, (growthIdx + 1) * blockSize);
        this.attacks = decrypted_data.slice(attacksIdx * blockSize, (attacksIdx + 1) * blockSize);
        this.evs = decrypted_data.slice(evsIdx * blockSize, (evsIdx + 1) * blockSize);
        this.misc = decrypted_data.slice(miscIdx * blockSize, (miscIdx + 1) * blockSize);
    }

    encryptData() {
        // Refresh PID/OTID from values in case they changed
        this.pid = RSESPUtils.readInt(this.values, this.pid_pos);
        this.ot_id = RSESPUtils.readInt(this.values, this.ot_id_pos);

        // Calculate Checksum & Prepare Data
        let checksum = 0;
        const plainData = new Uint8Array(this.enc_data_len); // 48 bytes

        // Shuffle blocks
        const index = this.pid % 24;
        const order = RSESPUtils.enc_positions[index];
        const growthIdx = (order >> 0) & 3;
        const attacksIdx = (order >> 2) & 3;
        const evsIdx = (order >> 4) & 3;
        const miscIdx = (order >> 6) & 3;

        const blockSize = 12;

        plainData.set(this.growth, growthIdx * blockSize);
        plainData.set(this.attacks, attacksIdx * blockSize);
        plainData.set(this.evs, evsIdx * blockSize);
        plainData.set(this.misc, miscIdx * blockSize);

        const encryptedData = new Uint8Array(this.enc_data_len);

        for (let i = 0; i < this.enc_data_len / 4; i++) {
            let val = RSESPUtils.readInt(plainData, i * 4);

            // Calc checksum on plain data
            let wordLow = val & 0xFFFF;
            let wordHigh = (val >>> 16) & 0xFFFF;
            checksum = (checksum + wordLow) & 0xFFFF;
            checksum = (checksum + wordHigh) & 0xFFFF;

            // Encrypt
            val ^= this.pid ^ this.ot_id;

            // Store
            RSESPUtils.writeInt(encryptedData, i * 4, val);
        }

        if (this.checksumFailed) {
            // Preserve broken checksum if it was originally broken?
            // Python ref: checksum += 1
            // But we probably want to fix it if we are editing.
            // For now, let's write the correct checksum.
        }

        this.values.set(encryptedData, this.enc_data_pos);
        RSESPUtils.writeShort(this.values, this.checksum_pos, checksum);
    }

    parseSubstructures() {
        // Used when data was not encrypted (e.g. raw build)
        // Assume values slice has correct data, shuffle logic applies
        // But for fresh object, we might just init empty?
        // Let's defer to what we need. Use decryptData with no encryption if needed or just init.
        this.growth = new Uint8Array(12);
        this.attacks = new Uint8Array(12);
        this.evs = new Uint8Array(12);
        this.misc = new Uint8Array(12);
    }

    // Getters from substructures
    getSpecies() { return RSESPUtils.readShort(this.growth, 0); }
    getItem() { return RSESPUtils.readShort(this.growth, 2); }
    getExp() { return RSESPUtils.readInt(this.growth, 4); }

    getMove(i) { return RSESPUtils.readShort(this.attacks, i * 2); }

    // ... other getters as needed ...

    add_version_info(data, start) {
        this.version_info = data.slice(start, start + this.version_info_len);
    }

    add_ribbon_info(data, start) {
        this.ribbon_info = data.slice(start, start + this.ribbon_info_len);
    }

    getData() {
        // Re-encrypt before returning
        this.encryptData();

        // Assemble full buffer
        // length + mail_len + version + ribbon
        const totalLen = this.pokemon_data_len + this.mail_len + this.version_info_len + this.ribbon_info_len;
        const data = new Uint8Array(totalLen);

        data.set(this.values, 0); // Core data

        // Mail (dummy for now unless we implement mail)
        // GSCPokemonInfo handles mail separately usually, but here it's part of the dump
        // We'll leave mail as zeros for now or use `this.mail` if we port it.
        // The Python `get_data` concatenates `sources = [self, self.mail]` then version/ribbon.

        // version
        data.set(this.version_info, this.pokemon_data_len + this.mail_len);

        // ribbon
        data.set(this.ribbon_info, this.pokemon_data_len + this.mail_len + this.version_info_len);

        return data;
    }
}

export class RSESPTradingData extends GSCTradingData {
    constructor(data, start) {
        // Note: JS constructor needs different signature than Python usually if we want to be idiomatic
        super(data, start);

        // Gen 3 Constants
        this.trading_party_max_size = 6;
        this.trading_pokemon_length = 0x64;
    }

    static generateChecksum(buf, lengths) {
        // Constants used in checksum calc
        const trading_party_max_size = 6;
        const trading_pokemon_length = 0x64;
        const trading_mail_length = 0x24; // 36
        const trading_mail_pos = 8;
        const trading_pokemon_pos = 0xE8;
        const trading_party_info_pos = 0xE4;

        let checksum = 0;

        // 1. Mail Checksum
        // Python: for i in range(cls.trading_party_max_size): for j in range(int(cls.trading_mail_length/4))...
        for (let i = 0; i < trading_party_max_size; i++) {
            for (let j = 0; j < trading_mail_length / 4; j++) {
                const offset = (i * trading_mail_length) + (j * 4) + trading_mail_pos;
                // Accumulate and keep within 32-bit unsigned
                checksum = (checksum + RSESPUtils.readInt(buf, offset)) >>> 0;
            }
        }
        RSESPUtils.writeInt(buf, trading_mail_pos + (trading_party_max_size * trading_mail_length), checksum);

        // 2. Party Info Checksum
        // Python: checksum = GSCUtilsMisc.read_int_le(buf, cls.trading_party_info_pos)
        checksum = RSESPUtils.readInt(buf, trading_party_info_pos);

        for (let i = 0; i < trading_party_max_size; i++) {
            for (let j = 0; j < trading_pokemon_length / 4; j++) {
                const offset = (i * trading_pokemon_length) + (j * 4) + trading_pokemon_pos;
                checksum = (checksum + RSESPUtils.readInt(buf, offset)) >>> 0;
            }
        }
        RSESPUtils.writeInt(buf, trading_pokemon_pos + (trading_party_max_size * trading_pokemon_length), checksum);

        // 3. Global Checksum (Final word of the section)
        checksum = 0;
        // Python: for i in range(int((lengths[0]-4)/4))
        const totalLen = lengths[0];
        for (let i = 0; i < (totalLen - 4) / 4; i++) {
            checksum = (checksum + RSESPUtils.readInt(buf, i * 4)) >>> 0;
        }
        RSESPUtils.writeInt(buf, totalLen - 4, checksum);
    }
}
