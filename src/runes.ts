import { Transaction, script, } from "bitcoinjs-lib";
import { base26Decode, base26Encode } from "./base26";
import { Varint } from "./varint";
import { Option, none, some } from "./fts";
import { encodeLEB128 } from "./leb128";

export class RuneId {
    constructor(public block: number, public idx: number) {

    }
}


export class Edict {
    constructor(public id: RuneId, public amount: number, public output: number) {

    }
}

export enum Flag {
    Etching = 0,
    Terms = 1,
    Turbo = 2,
    Cenotaph = 127,
}

export enum Tag {
    Body = 0,
    Flags = 2,
    Rune = 4,
    Premine = 6,
    Cap = 8,
    Amount = 10,
    HeightStart = 12,
    HeightEnd = 14,
    OffsetStart = 16,
    OffsetEnd = 18,
    Mint = 20,
    Pointer = 22,
    Cenotaph = 126,

    Divisibility = 1,
    Spacers = 3,
    Symbol = 5,
    Nop = 127,
}



export enum Flaw {
    EdictOutput,
    EdictRuneId,
    InvalidScript,
    Opcode,
    SupplyOverflow,
    TrailingIntegers,
    TruncatedField,
    UnrecognizedEvenTag,
    UnrecognizedFlag,
    Varint,
}

export class Range {
    constructor(public start: Option<number>, public end: Option<number>) {

    }
}


export class Terms {
    constructor(public amount: number, public cap: number, public height: Range, public offset: Range) {

    }
}


export class Rune {

    constructor(public value: bigint) {

    }

    public get name(): string {
        return Rune.toName(this.value)
    }

    public static toName(s: bigint): string {
        return base26Decode(s);
    }


    public static fromName(s: string): Rune {
        return new Rune(base26Encode(s));
    }

    toString() {
        return this.name;
    }
}


export class Etching {

    static readonly MAX_DIVISIBILITY: number = 38;
    static readonly MAX_SPACERS: number = 0b00000111_11111111_11111111_11111111;

    constructor(
        public divisibility: Option<number>,
        public premine: Option<number>,
        public rune: Option<Rune>,
        public spacers: Option<number>,
        public symbol: Option<string>,
        public terms: Option<Terms>,
        public turbo: boolean) {

    }

}

export class Runestone {

    static readonly MAGIC_NUMBER: number = 93;
    constructor(
        public edicts: Array<Edict> = [],
        public etching: Option<Etching>,
        public mint: Option<RuneId>,
        public pointer: Option<number>) {
    }


    static decipher(rawTx: string): Option<Runestone> {
        const tx = Transaction.fromHex(rawTx);

        const payload = Runestone.payload(tx);

        if (payload.isSome()) {
            const integers = Runestone.integers(payload.value() as number[]);


            const message = Message.from_integers(tx, integers.value() as bigint[]);

            const etching = message.getEtching();

            const mint = message.getMint();
            const pointer = message.getPointer();

            return some(new Runestone(message.edicts, etching, mint, pointer));

        }

        return none();
    }


    static encipher(
        message: Message
    ): Buffer {
        const prefix = Buffer.from('6a5d', 'hex')  // OP_RETURN OP_13
        return Buffer.concat([prefix, message.toBuffer()])
    }


    static payload(tx: Transaction): Option<number[]> {

        for (const output of tx.outs) {
            //script.fromASM
            const ls = script.decompile(output.script) as Array<number | Uint8Array>;

            if (ls[0] !== script.OPS.OP_RETURN) {
                continue;
            }


            if (ls[1] !== Runestone.MAGIC_NUMBER) {
                continue;
            }

            for (let i = 2; i < ls.length; i++) {
                const element = ls[i];

                if (element instanceof Uint8Array) {
                    return some(Array.from(element))
                }
                return none();
            }


            return none();

        }

        return none();
    }


    static integers(payload: number[]): Option<bigint[]> {
        let integers: bigint[] = [];
        let i = 0;

        while (i < payload.length) {
            let {
                n,
                len
            } = Varint.decode(payload.slice(i));
            integers.push(n);
            i += len;
        }

        return some(integers)
    }

}




export class Message {

    constructor(
        public fields: Map<number, Array<bigint>>,
        public edicts: Array<Edict>,
        public flaws: number,
    ) {

    }

    static from_integers(tx: Transaction, integers: bigint[]): Message {

        let edicts: Array<Edict> = [];
        let fields: Map<number, bigint[]> = new Map();
        let flaws = 0;


        for (let i = 0; i < integers.length;) {
            let tag = integers[i];

            let val = integers[i + 1];

            const vals = fields.get(Number(tag)) || [];
            vals.push(val);

            fields.set(Number(tag), vals);

            i += 2;

        }

        return new Message(fields, edicts, flaws);
    }

    addFieldVal(tag: number, val: bigint) {
        const vals = this.fields.get(Number(tag)) || [];
        vals.push(val);

        this.fields.set(Number(tag), vals);
    }

    addEdict(edict: Edict) {
        this.edicts.push(edict)
    }

    toBuffer(): Buffer {
        const buffArr: Buffer[] = []

        // Serialize fields.
        for (const [tag, vals] of this.fields) {
            for (const val of vals) {
                const tagBuff = Buffer.alloc(1)
                tagBuff.writeUInt8(tag)
                buffArr.push(tagBuff)

                buffArr.push(encodeLEB128(val))
            }
        }

        // Serialize edicts.
        buffArr.push(Buffer.from('00', 'hex'))
        // 1) Sort by block height
        // 2) Sort by tx idx
        this.edicts.sort((a, b) => {
            if (a.id.block == b.id.block) {
                return a.id.idx - b.id.idx
            }
            return a.id.block - b.id.block
        })
        // 3) Delta encode
        let lastBlockHeight
        let lastTxIdx
        for (let i = 0; i < this.edicts.length; i++) {
            const edict = this.edicts[i]
            if (i == 0) {
                lastBlockHeight = BigInt(edict.id.block)
                lastTxIdx = BigInt(edict.id.idx)
                buffArr.push(encodeLEB128(lastBlockHeight))
                buffArr.push(encodeLEB128(lastTxIdx))
            } else {
                const currBlockHeight = BigInt(edict.id.block)
                const currTxIdx = BigInt(edict.id.idx)

                if (currBlockHeight == lastBlockHeight) {
                    const deltaTxIdx = currTxIdx - lastTxIdx

                    buffArr.push(encodeLEB128(0n))
                    buffArr.push(encodeLEB128(deltaTxIdx))
                } else {
                    const deltaBlockHeight = currBlockHeight - lastBlockHeight
                    lastBlockHeight = currBlockHeight
                    lastTxIdx = currTxIdx

                    buffArr.push(encodeLEB128(deltaBlockHeight))
                    buffArr.push(encodeLEB128(currTxIdx))
                }
            }

            buffArr.push(encodeLEB128(BigInt(edict.amount)))
            buffArr.push(encodeLEB128(BigInt(edict.output)))
        }

        return Buffer.concat(buffArr)
    }

    getFlags(): number {
        return Number(this.fields.get(Tag.Flags));
    }

    hasFlags(flag: Flag): boolean {

        const flags = this.getFlags();

        const mask = 1 << flag;

        return (flags & mask) != 0
    }

    getMint(): Option<RuneId> {
        if (!this.fields.has(Tag.Mint)) {
            return none();
        }

        const [block, tx] = this.fields.get(Tag.Mint) as [bigint, bigint];

        return some(new RuneId(Number(block), Number(tx)));
    }

    getEtching(): Option<Etching> {
        if (!this.hasFlags(Flag.Etching)) {
            return none();
        }

        const divisibility = this.getDivisibility();

        const premine = this.getPremine();

        const rune = this.getRune();
        const spacers = this.getSpacers();
        const symbol = this.getSymbol();
        const terms = this.getTerms();
        const turbo = this.hasFlags(Flag.Turbo);


        return some(new Etching(divisibility, premine, rune, spacers, symbol, terms, turbo));

    }

    getDivisibility(): Option<number> {
        if (!this.fields.has(Tag.Divisibility)) {
            return none();
        }
        const [divisibility] = this.fields.get(Tag.Divisibility) as [bigint];

        if (divisibility > Etching.MAX_DIVISIBILITY) {
            throw new Error("invalid divisibility");
        }

        return some(Number(divisibility));
    }

    getPremine(): Option<number> {
        if (!this.fields.has(Tag.Premine)) {
            return none();
        }
        const [premine] = this.fields.get(Tag.Premine) as [bigint];

        return some(Number(premine));
    }

    getRune(): Option<Rune> {
        if (!this.fields.has(Tag.Rune)) {
            return none();
        }
        const [rune] = this.fields.get(Tag.Rune) as [bigint];

        return some(new Rune(rune));
    }

    getSpacers(): Option<number> {
        if (!this.fields.has(Tag.Spacers)) {
            return none();
        }
        const [spacers] = this.fields.get(Tag.Spacers) as [bigint];
        if (spacers > Etching.MAX_SPACERS) {
            throw new Error("invalid spacers");
        }
        return some(Number(spacers));
    }


    getHeightStart(): Option<number> {
        if (!this.fields.has(Tag.HeightStart)) {
            return none();
        }
        const [heightStart] = this.fields.get(Tag.HeightStart) as [bigint];

        return some(Number(heightStart));
    }

    getHeightEnd(): Option<number> {
        if (!this.fields.has(Tag.HeightEnd)) {
            return none();
        }
        const [heightEnd] = this.fields.get(Tag.HeightEnd) as [bigint];

        return some(Number(heightEnd));
    }

    getOffsetStart(): Option<number> {
        if (!this.fields.has(Tag.OffsetStart)) {
            return none();
        }
        const [offsetStart] = this.fields.get(Tag.OffsetStart) as [bigint];

        return some(Number(offsetStart));
    }

    getOffsetEnd(): Option<number> {
        if (!this.fields.has(Tag.OffsetEnd)) {
            return none();
        }
        const [offsetEnd] = this.fields.get(Tag.OffsetEnd) as [bigint];

        return some(Number(offsetEnd));
    }

    getCap(): Option<number> {
        if (!this.fields.has(Tag.Cap)) {
            return none();
        }
        const [cap] = this.fields.get(Tag.Cap) as [bigint];

        return some(Number(cap));
    }

    getAmount(): Option<number> {
        if (!this.fields.has(Tag.Amount)) {
            return none();
        }
        const [amount] = this.fields.get(Tag.Amount) as [bigint];

        return some(Number(amount));
    }


    getSymbol(): Option<string> {
        if (!this.fields.has(Tag.Symbol)) {
            return none();
        }
        const [symbol] = this.fields.get(Tag.Symbol) as [bigint];

        return some(String.fromCharCode(Number(symbol)));
    }


    getTerms(): Option<Terms> {
        if (!this.hasFlags(Flag.Terms)) {
            return none();
        }

        const cap = this.getCap();

        if (!cap.isSome()) {
            throw new Error("no cap field")
        }

        const amount = this.getAmount();

        if (!amount.isSome()) {
            throw new Error("no amount field")
        }

        const heightStart = this.getHeightStart();
        const heightEnd = this.getHeightEnd();

        const offsetStart = this.getOffsetStart();
        const offsetEnd = this.getOffsetEnd();

        const height = new Range(heightStart, heightEnd);

        const offset = new Range(offsetStart, offsetEnd);


        return some(new Terms(amount.value() as number, cap.value() as number, height, offset));
    }



    getPointer(): Option<number> {
        if (!this.fields.has(Tag.Pointer)) {
            return none();
        }

        const [pointer] = this.fields.get(Tag.Pointer) as [bigint];

        return some(Number(pointer));
    }

}
