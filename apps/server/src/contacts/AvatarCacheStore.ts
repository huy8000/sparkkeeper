import { createHash } from 'node:crypto';
import {
  AvatarAssetRepository,
  AccountRepository,
  type DatabaseClient,
  type AvatarAsset,
} from '@sparkkeeper/database';
import { ContactFiles } from './ContactFiles.js';
import { uuid } from './ContactDiscoveryWorkerProtocol.js';
const retention = 30 * 86400000;
export function validAvatar(bytes: Buffer, mime: string): boolean {
  if (bytes.length === 0 || bytes.length > 5242880) return false;
  switch (mime) {
    case 'image/png':
      return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    case 'image/jpeg':
      return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    case 'image/gif':
      return ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'));
    case 'image/webp':
      return (
        bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
        bytes.subarray(8, 12).toString('ascii') === 'WEBP'
      );
    default:
      return false;
  }
}
export class AvatarCacheStore {
  private readonly files: ContactFiles | undefined;
  private readonly repo: AvatarAssetRepository;
  constructor(
    root: string,
    private readonly database: DatabaseClient,
  ) {
    try {
      this.files = new ContactFiles(root);
    } catch {
      // Optional cache remains disabled; never bypass anchored safety checks.
      this.files = undefined;
    }
    this.repo = new AvatarAssetRepository(database);
  }
  get disabled(): boolean {
    return this.files === undefined;
  }
  /** Only internal already-loaded, bounded image bytes. No URL fetching API. */
  store(accountId: string, bytes: Buffer, mime: string, now = new Date()): AvatarAsset | undefined {
    try {
      if (!this.files) return undefined;
      if (!uuid(accountId) || !validAvatar(bytes, mime)) return undefined;
      const digest = createHash('sha256').update(bytes).digest('hex');
      const key = `${accountId}_${digest}`;
      if (!this.files.put(key, bytes)) {
        const previous = this.files.get(key);
        if (!previous || !previous.equals(bytes)) return undefined;
      }
      const asset = this.repo.findByCacheKey(key);
      if (asset) {
        this.repo.touch(asset.id, now, new Date(now.getTime() + retention));
        return this.repo.findById(asset.id);
      }
      return this.repo.create({
        accountId,
        cacheKey: key,
        mediaType: mime,
        byteSize: bytes.length,
        contentDigest: digest,
        fetchedAt: now,
        lastReferencedAt: now,
        expiresAt: new Date(now.getTime() + retention),
        now,
      });
    } catch {
      return undefined;
    }
  }
  read(id: string, now = new Date()): { bytes: Buffer; mime: string } | undefined {
    try {
      if (!this.files) return undefined;
      const asset = this.repo.findById(id);
      if (!asset || !this.safeKey(asset) || !asset.expiresAt || asset.expiresAt <= now)
        return undefined;
      const account = new AccountRepository(this.database).findById(asset.accountId);
      if (!account) return undefined;
      const bytes = this.files.get(asset.cacheKey);
      if (
        !bytes ||
        bytes.length !== asset.byteSize ||
        !validAvatar(bytes, asset.mediaType) ||
        createHash('sha256').update(bytes).digest('hex') !== asset.contentDigest
      )
        return undefined;
      return { bytes, mime: asset.mediaType };
    } catch {
      return undefined;
    }
  }
  cleanup(now = new Date(), excludeActive = false): void {
    try {
      if (!this.files || excludeActive) return;
      for (const key of this.files.list().slice(0, 50)) {
        if (!/^(?:[0-9a-f-]{36}_[0-9a-f]{64}|pending-[0-9]+-[0-9a-f_-]+)$/u.test(key)) continue;
        const asset = this.repo.findByCacheKey(key);
        const modified = this.files.modifiedAt(key);
        if (modified === undefined) continue;
        if (asset) {
          if (this.safeKey(asset) && asset.expiresAt && asset.expiresAt <= now)
            this.files.remove(key);
        } else if (now.getTime() - modified >= retention) this.files.remove(key);
      }
    } catch {
      /* Optional cache cleanup never changes Contact/run truth. */
    }
  }
  private safeKey(asset: AvatarAsset) {
    return (
      uuid(asset.accountId) &&
      asset.cacheKey === `${asset.accountId}_${asset.contentDigest}` &&
      /^[0-9a-f]{64}$/u.test(asset.contentDigest)
    );
  }
}
