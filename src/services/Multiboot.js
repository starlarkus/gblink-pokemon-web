/**
 * GBA Multiboot Implementation for WebUSB
 * Sends a ROM file to a GBA via the link cable using the multiboot protocol.
 */

const CONFIG_SIGNATURE = [
    0xCA, 0xFE, 0xCA, 0xFE, 0xCA, 0xFE, 0xCA, 0xFE,
    0xCA, 0xFE, 0xCA, 0xFE, 0xCA, 0xFE, 0xCA, 0xFE,
    0xDE, 0xAD, 0xBE, 0xEF, 0xDE, 0xAD, 0xBE, 0xEF,
    0xDE, 0xAD, 0xBE, 0xEF, 0xDE, 0xAD, 0xBE, 0xEF
];

function getConfigureList(usBetweenTransfer, bytesForTransfer) {
    const config = new Uint8Array(36);
    for (let i = 0; i < 32; i++) config[i] = CONFIG_SIGNATURE[i];
    config[32] = usBetweenTransfer & 0xFF;
    config[33] = (usBetweenTransfer >> 8) & 0xFF;
    config[34] = (usBetweenTransfer >> 16) & 0xFF;
    config[35] = bytesForTransfer & 0xFF;
    return config;
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function readAll(usb) {
    await delay(10);
    let output = 0;
    while (true) {
        try {
            const data = await usb.readBytesRaw(64);
            if (!data || data.length === 0) break;
            for (let i = 0; i < data.length; i++) output = (output << 8) | data[i];
            if (data.length < 64) break;
        } catch (e) { break; }
    }
    return output >>> 0;
}

async function Spi32(usb, val) {
    const tx = new Uint8Array([
        (val >>> 24) & 0xFF,
        (val >>> 16) & 0xFF,
        (val >>> 8) & 0xFF,
        val & 0xFF
    ]);
    await usb.writeBytes(tx);
    const rx = await usb.readBytesRaw(4, 2000);
    if (!rx || rx.length < 4) return 0;
    return ((rx[0] << 24) | (rx[1] << 16) | (rx[2] << 8) | rx[3]) >>> 0;
}

/**
 * Send multiple 32-bit SPI words in a single USB transfer.
 * The firmware processes them as sequential 4-byte SPI exchanges
 * and returns all results at once, drastically reducing USB round-trips.
 * @param {UsbConnection} usb
 * @param {number[]} values - Array of 32-bit values to send
 * @returns {number[]|null} Array of 32-bit responses, or null on failure
 */
async function Spi32Batch(usb, values) {
    const count = values.length;
    const txBatch = new Uint8Array(count * 4);
    for (let i = 0; i < count; i++) {
        const val = values[i];
        txBatch[i * 4] = (val >>> 24) & 0xFF;
        txBatch[i * 4 + 1] = (val >>> 16) & 0xFF;
        txBatch[i * 4 + 2] = (val >>> 8) & 0xFF;
        txBatch[i * 4 + 3] = val & 0xFF;
    }
    await usb.writeBytes(txBatch);

    // Accumulate reads — firmware may split response across multiple USB packets
    const expectedBytes = count * 4;
    const chunks = [];
    let totalReceived = 0;
    while (totalReceived < expectedBytes) {
        const chunk = await usb.readBytesRaw(expectedBytes - totalReceived, 2000);
        if (!chunk || chunk.length === 0) return null;
        chunks.push(chunk);
        totalReceived += chunk.length;
    }

    // Merge chunks into single buffer
    const rxBatch = new Uint8Array(totalReceived);
    let offset = 0;
    for (const chunk of chunks) {
        rxBatch.set(chunk, offset);
        offset += chunk.length;
    }

    const results = [];
    for (let i = 0; i < count; i++) {
        results.push(((rxBatch[i * 4] << 24) | (rxBatch[i * 4 + 1] << 16) |
            (rxBatch[i * 4 + 2] << 8) | rxBatch[i * 4 + 3]) >>> 0);
    }
    return results;
}

// Max words per USB batch. 8 words × 4 bytes = 32 bytes.
// Kept under 64 bytes to fit comfortably within the firmware's TX FIFO.
const BATCH_WORDS = 8;

export async function multiboot(usb, romData, log = console.log) {
    const fdata = new Uint8Array(romData);
    let fsize = fdata.length;

    if (fsize > 0x40000) {
        log("File size Error Max 256KB", "error");
        return false;
    }

    log(`ROM size: ${fsize} bytes (${(fsize / 1024).toFixed(1)} KB)`);

    // Pad data
    const paddedData = new Uint8Array(fsize + 0x10);
    paddedData.set(fdata);

    // Configure firmware
    log("Configuring firmware for GBA mode...");
    const config = getConfigureList(36, 4);
    await usb.writeBytes(config);
    await readAll(usb);

    // Wait for GBA
    log("Waiting for GBA... Turn on your GBA with the link cable connected.");

    let recv, attempts = 0;
    do {
        recv = (await Spi32(usb, 0x6202)) >>> 16;
        await delay(10);
        attempts++;
        if (attempts % 100 === 0) log(`Still waiting... (${attempts / 100}s)`, "info");
        if (attempts > 6000) { log("Timeout", "error"); return false; }
    } while (recv !== 0x7202);

    log("GBA detected! Starting transfer...", "success");

    // Handshake
    await Spi32(usb, 0x6102);

    // Send header (0x00–0xC0) in batches
    const headerWords = [];
    for (let i = 0; i < 0xC0; i += 2) {
        headerWords.push(paddedData[i] | (paddedData[i + 1] << 8));
    }
    for (let i = 0; i < headerWords.length; i += BATCH_WORDS) {
        const batch = headerWords.slice(i, i + BATCH_WORDS);
        const results = await Spi32Batch(usb, batch);
        if (!results) { log("Header transfer failed", "error"); return false; }
    }

    await Spi32(usb, 0x6200);
    await Spi32(usb, 0x6202);
    await Spi32(usb, 0x63D1);

    const token = await Spi32(usb, 0x63D1);
    if ((token >>> 24) !== 0x73) { log("Failed handshake!", "error"); return false; }

    log("Handshake successful!", "success");

    // CRC setup
    let crcA = (token >>> 16) & 0xFF;
    let seed = (0xFFFF00D1 | (crcA << 8)) >>> 0;
    crcA = (crcA + 0x0F) & 0xFF;

    await Spi32(usb, 0x6400 | crcA);

    fsize += 0x0F;
    fsize &= ~0x0F;

    const token2 = await Spi32(usb, ((fsize - 0x190) / 4) >>> 0);
    const crcB = (token2 >>> 16) & 0xFF;
    let crcC = 0xC387;

    log(`Sending data (${fsize} bytes)...`);

    // Bulk data transfer (0xC0–fsize) in batches
    let lastProgress = -1;
    for (let i = 0xC0; i < fsize;) {
        const wordsInBatch = Math.min(BATCH_WORDS, (fsize - i) / 4);
        const batchValues = [];

        // Pre-compute all encrypted words for this batch
        for (let w = 0; w < wordsInBatch; w++) {
            const offset = i + w * 4;

            // Read 32-bit little-endian
            let dat = paddedData[offset] |
                (paddedData[offset + 1] << 8) |
                (paddedData[offset + 2] << 16) |
                ((paddedData[offset + 3] << 24) >>> 0);
            dat = dat >>> 0;

            // CRC step
            let tmp = dat;
            for (let b = 0; b < 32; b++) {
                const bit = (crcC ^ tmp) & 1;
                crcC = (crcC >>> 1) ^ (bit ? 0xC37B : 0);
                tmp = tmp >>> 1;
            }

            // Encrypt step - use BigInt to avoid precision loss!
            seed = Number((BigInt(seed) * 0x6F646573n + 1n) & 0xFFFFFFFFn);
            dat = (seed ^ dat ^ ((0xFE000000 - offset) >>> 0) ^ 0x43202F2F) >>> 0;

            batchValues.push(dat);
        }

        // Send batch and read all responses
        const responses = await Spi32Batch(usb, batchValues);
        if (!responses) {
            log(`Read timeout during batch transfer at byte ${i}`, "error");
            return false;
        }

        // Verify each response
        for (let w = 0; w < wordsInBatch; w++) {
            const offset = i + w * 4;
            const chk = (responses[w] >>> 16) & 0xFFFF;
            if (chk !== (offset & 0xFFFF)) {
                log(`Transmission error at byte ${offset}: expected 0x${(offset & 0xFFFF).toString(16)}, got 0x${chk.toString(16)}`, "error");
                return false;
            }
        }

        i += wordsInBatch * 4;

        // Progress
        const progress = Math.floor(((i - 0xC0) / (fsize - 0xC0)) * 10);
        if (progress > lastProgress) {
            log(`Progress: ${progress * 10}%`, "info");
            lastProgress = progress;
        }
    }

    log("Data sent successfully!", "success");

    // Final CRC
    let tmp = ((0xFFFF0000 | (crcB << 8) | crcA) >>> 0);
    for (let b = 0; b < 32; b++) {
        const bit = (crcC ^ tmp) & 1;
        crcC = (crcC >>> 1) ^ (bit ? 0xC37B : 0);
        tmp = tmp >>> 1;
    }

    // Acknowledgment
    log("Waiting for GBA acknowledgment...");
    await Spi32(usb, 0x0065);

    do {
        recv = (await Spi32(usb, 0x0065)) >>> 16;
        await delay(10);
    } while (recv !== 0x0075);

    await Spi32(usb, 0x0066);
    await Spi32(usb, crcC & 0xFFFF);

    log("Multiboot complete! ROM loaded.", "success");
    await delay(1000);
    return true;
}

export { getConfigureList };
