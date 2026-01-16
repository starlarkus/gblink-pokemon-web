/**
 * GSCJPMailConverter - Converts mail data between Japanese and International GSC formats
 * Based on ref. impl's gsc_trading_jp.py
 */

export class GSCJPMailConverter {
    static BASE_PATH = '/data/gsc/';
    static TABLE_TO_JP_PATH = 'mail_conversion_table_en_to_jp.bin';
    static TABLE_TO_INT_PATH = 'mail_conversion_table_jp_to_en.bin';
    static MAIL_JP_CHECKS_PATH = 'mail_checks_jp.bin';

    static END_OF_LINE = 0x50;
    static EXTRA_DISTANCE_JP = 5;
    static EXTRA_DISTANCE_INT = 0x0A;
    static FULL_MAIL_JP_LEN = 0x2A;
    static MAIL_LEN = 0x21;
    static SENDER_INT_LEN = 0x0E;

    // Position arrays for 6 mail slots
    static MAIL_POS_JP = [0, 1, 2, 3, 4, 5].map(i => i * GSCJPMailConverter.FULL_MAIL_JP_LEN);
    static MAIL_POS_INT = [0, 1, 2, 3, 4, 5].map(i => i * GSCJPMailConverter.MAIL_LEN);

    static SENDER_POS_JP = [0, 1, 2, 3, 4, 5].map(i => 0x21 + (i * GSCJPMailConverter.FULL_MAIL_JP_LEN));
    static SENDER_POS_INT = [0, 1, 2, 3, 4, 5].map(i => 0xC6 + (i * GSCJPMailConverter.SENDER_INT_LEN));

    constructor() {
        this.mailConversionTableJp = null;
        this.mailConversionTableInt = null;
        this.mailChecker = null;
        this.loaded = false;

        // Conversion state
        this.mailConvPos = -1;
        this.senderConvPos = -1;
        this.singleMailPos = 0;
        this.singleSenderPos = 0;
        this.extraConversionPos = -1;
        this.mailConverterPos = null;
        this.senderConverterPos = null;
        this.extraDistance = 0;

        // Bind conversion functions
        this.conversionFunctions = [
            this.doZero.bind(this),
            this.mailConversion.bind(this),
            this.senderConversion.bind(this),
            this.extraConversion.bind(this),
            this.doFF.bind(this),
            this.do20.bind(this),
            this.startMailConversion.bind(this),
            this.doEol.bind(this),
            this.startSenderConversion.bind(this)
        ];
    }

    /**
     * Load the conversion tables from binary files
     */
    async load() {
        if (this.loaded) return;

        try {
            // Load conversion tables
            const tableToJpData = await this.loadBinaryFile(GSCJPMailConverter.TABLE_TO_JP_PATH);
            const tableToIntData = await this.loadBinaryFile(GSCJPMailConverter.TABLE_TO_INT_PATH);
            const mailChecksData = await this.loadBinaryFile(GSCJPMailConverter.MAIL_JP_CHECKS_PATH);

            // Prepare function maps from raw data
            this.mailConversionTableJp = this.prepareFunctionsMap(tableToJpData);
            this.mailConversionTableInt = this.prepareFunctionsMap(tableToIntData);
            this.mailChecker = mailChecksData; // Raw check data

            this.loaded = true;
            console.log('[GSCJPMailConverter] Loaded Japanese mail conversion tables');
        } catch (error) {
            console.error('[GSCJPMailConverter] Failed to load conversion tables:', error);
            throw error;
        }
    }

    /**
     * Load a binary file and return as Uint8Array
     */
    async loadBinaryFile(filename) {
        const response = await fetch(GSCJPMailConverter.BASE_PATH + filename);
        if (!response.ok) {
            throw new Error(`Failed to load ${filename}: ${response.status}`);
        }
        const buffer = await response.arrayBuffer();
        return new Uint8Array(buffer);
    }

    /**
     * Prepare function map from raw binary data
     * Each byte maps to a conversion function
     */
    prepareFunctionsMap(data) {
        const result = [];
        for (let i = 0; i < data.length; i++) {
            const funcIndex = data[i];
            if (funcIndex < this.conversionFunctions.length) {
                result.push(this.conversionFunctions[funcIndex]);
            } else {
                // Default to doZero for invalid indices
                result.push(this.conversionFunctions[0]);
            }
        }
        return result;
    }

    /**
     * Convert International mail data to Japanese format
     */
    convertToJp(data) {
        this.mailConverterPos = GSCJPMailConverter.MAIL_POS_INT;
        this.senderConverterPos = GSCJPMailConverter.SENDER_POS_INT;
        this.extraDistance = GSCJPMailConverter.EXTRA_DISTANCE_INT;
        return this.convert(data, this.mailConversionTableJp);
    }

    /**
     * Convert Japanese mail data to International format
     */
    convertToInt(data) {
        this.mailConverterPos = GSCJPMailConverter.MAIL_POS_JP;
        this.senderConverterPos = GSCJPMailConverter.SENDER_POS_JP;
        this.extraDistance = GSCJPMailConverter.EXTRA_DISTANCE_JP;
        return this.convert(data, this.mailConversionTableInt);
    }

    /**
     * Perform conversion using the given converter table
     */
    convert(toConvert, converter) {
        this.mailConvPos = -1;
        this.senderConvPos = -1;

        const result = new Uint8Array(converter.length);
        for (let i = 0; i < converter.length; i++) {
            result[i] = converter[i](toConvert);
        }
        return result;
    }

    // === Conversion Functions ===

    doZero(data) {
        return 0;
    }

    mailConversion(data) {
        this.singleMailPos += 1;
        const pos = this.mailConverterPos[this.mailConvPos] + this.singleMailPos;
        return pos < data.length ? data[pos] : 0;
    }

    senderConversion(data) {
        this.singleSenderPos += 1;
        const pos = this.senderConverterPos[this.senderConvPos] + this.singleSenderPos;
        return pos < data.length ? data[pos] : 0;
    }

    extraConversion(data) {
        this.extraConversionPos += 1;
        const pos = this.senderConverterPos[this.senderConvPos] + this.extraDistance + this.extraConversionPos;
        return pos < data.length ? data[pos] : 0;
    }

    startMailConversion(data) {
        this.mailConvPos += 1;
        this.singleMailPos = 0;
        const pos = this.mailConverterPos[this.mailConvPos] + this.singleMailPos;
        return pos < data.length ? data[pos] : 0;
    }

    startSenderConversion(data) {
        this.senderConvPos += 1;
        this.singleSenderPos = 0;
        this.extraConversionPos = -1;
        const pos = this.senderConverterPos[this.senderConvPos] + this.singleSenderPos;
        return pos < data.length ? data[pos] : 0;
    }

    doFF(data) {
        return 0xFF;
    }

    doEol(data) {
        return GSCJPMailConverter.END_OF_LINE;
    }

    do20(data) {
        return 0x20;
    }

    /**
     * Get the mail checker data for Japanese validation
     */
    getMailChecker() {
        return this.mailChecker;
    }

    /**
     * Check if converter is loaded
     */
    isLoaded() {
        return this.loaded;
    }
}
