import { Buffer } from 'buffer'

export function encodeLEB128(value: bigint): Buffer {
    const bytes = []
    let more = true

    while (more) {
        let byte = Number(value & BigInt(0x7f)) // Get the lowest 7 bits
        value >>= BigInt(7)
        if (value === BigInt(0)) {
            // No more data to encode
            more = false
        } else {
            // More bytes to come
            byte |= 0x80 // Set the continuation bit
        }
        bytes.push(byte)
    }

    // Convert array to Buffer
    return Buffer.from(bytes)
}

export function decodeLEB128(buffer: Buffer): bigint {
    let result = BigInt(0)
    let shift = 0
    const size = buffer.length
    let byte = 0

    for (let i = 0; i < size; i++) {
        byte = buffer[i]
        result |= BigInt(byte & 0x7f) << BigInt(shift)
        if ((byte & 0x80) === 0) {
            break
        }
        shift += 7
    }

    return result
}
