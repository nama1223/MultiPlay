/** lamejs には型定義が無いため、使う範囲だけ宣言する */
declare module 'lamejs' {
  export class Mp3Encoder {
    constructor(channels: number, sampleRate: number, bitRate: number)
    encodeBuffer(left: Int16Array, right?: Int16Array): Int8Array
    flush(): Int8Array
  }
}

declare module 'lamejs/src/js/MPEGMode.js' {
  const x: unknown
  export default x
}
declare module 'lamejs/src/js/Lame.js' {
  const x: unknown
  export default x
}
declare module 'lamejs/src/js/BitStream.js' {
  const x: unknown
  export default x
}
