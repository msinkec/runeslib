export function base26Encode(input: string): bigint {
    let result = 0n

    for (let i = 0; i < input.length; i++) {
        const charCode = BigInt(input.charCodeAt(i) - 'A'.charCodeAt(0))

        const iInv = BigInt(input.length) - 1n - BigInt(i)

        if (iInv == 0n) {
            result += charCode
        } else {
            const base = 26n ** iInv
            result += base * (charCode + 1n)
        }
    }

    return result
}
