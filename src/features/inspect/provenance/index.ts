import { createC2pa, Reader, Context } from '@contentauth/c2pa-web';
import wasmSrc from '@contentauth/c2pa-web/resources/c2pa.wasm?url';
import { mapProvenance } from './map';
import type { CheckResult } from '../../../contracts';

/** Explicitly offline settings; no trust-resource URLs or anchors are supplied. */
export const OFFLINE_SETTINGS = {
  verify: {
    verifyAfterReading: true,
    verifyTrust: false,
    verifyTimestampTrust: false,
    remoteManifestFetch: false,
    ocspFetch: false,
  },
  trust: { verifyTrustList: false },
  cawgTrust: { verifyTrustList: false },
} as const;

/** Validate embedded credentials locally; all SDK resources are served by the app origin. */
export async function readProvenance(bytes: Uint8Array, assetId: string): Promise<CheckResult> {
  let sdk: Awaited<ReturnType<typeof createC2pa>> | undefined;
  let reader: Reader | null = null;
  let result = mapProvenance(null, assetId, true);
  try {
    sdk = await createC2pa({ wasmSrc });
    const format = bytes[0] === 0xff && bytes[1] === 0xd8 ? 'image/jpeg' : undefined;
    const blob = new Blob([new Uint8Array(bytes)], { type: format ?? '' });
    reader = await Reader.fromBlob(sdk, format, blob, new Context(OFFLINE_SETTINGS));
    result = mapProvenance(reader ? await reader.manifestStore() : null, assetId);
  } catch {
    result = mapProvenance(null, assetId, true);
  } finally {
    try {
      await reader?.free();
    } catch {
      result = mapProvenance(null, assetId, true);
    }
    try {
      sdk?.dispose();
    } catch {
      result = mapProvenance(null, assetId, true);
    }
  }
  return result;
}
