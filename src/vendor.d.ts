/** Type declarations for packages without their own types. */

declare module "qrcode-terminal" {
  const qrterm: {
    generate: (text: string, opts?: { small?: boolean }) => void;
  };
  export default qrterm;
}

declare module "silk-wasm" {
  export function decode(
    silkData: Buffer,
    sampleRate: number,
  ): Promise<{ data: Uint8Array; duration: number }>;
}
