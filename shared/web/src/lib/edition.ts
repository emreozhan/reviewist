import type { AppConfig, Edition } from '../../../src/shared/types';

/** Bir uygulama sürümünün kullanıcıya görünen sabitleri. */
export interface EditionInfo {
  edition: Edition;
  /** Uygulamanın tam adı (logo yanı, sekme başlığı). */
  appName: string;
  /** Sunucuyu başlatma komutu (proje klasöründe). */
  startCommand: string;
  /** Sunucunun varsayılan portu. */
  defaultPort: number;
}

const INFO: Record<Edition, EditionInfo> = {
  local: { edition: 'local', appName: 'Reviewist Yerel', startCommand: 'node bin/reviewist-local.js', defaultPort: 4317 },
  github: { edition: 'github', appName: 'Reviewist GitHub', startCommand: 'node bin/reviewist-github.js', defaultPort: 4318 },
};

export function isEdition(value: unknown): value is Edition {
  return value === 'local' || value === 'github';
}

/** Sürümün sabitleri (sürüm sabitinden bağımsız; test edilebilir). */
export function editionInfo(edition: Edition): EditionInfo {
  return INFO[edition];
}

/** Bu arayüzün derlendiği sürüm. Ölü kod atımı için dallanmada doğrudan `__EDITION__` kullanın. */
export const EDITION: Edition = __EDITION__;
export const IS_LOCAL: boolean = __EDITION__ === 'local';
export const IS_GITHUB: boolean = __EDITION__ === 'github';
export const APP_NAME: string = INFO[__EDITION__].appName;
export const START_COMMAND: string = INFO[__EDITION__].startCommand;
export const DEFAULT_PORT: number = INFO[__EDITION__].defaultPort;

/**
 * Arayüzün derlendiği sürüm ile sunucunun bildirdiği sürüm uyuşmuyorsa Türkçe uyarı (ör. yanlış porta bağlanıldı);
 * uyuşuyorsa ya da yapılandırma henüz yoksa undefined.
 */
export function editionMismatch(built: Edition, config: Pick<AppConfig, 'edition'> | undefined): string | undefined {
  if (!config) return undefined;
  const server: unknown = config.edition;
  if (server === built) return undefined;
  const ours = INFO[built];
  if (!isEdition(server)) {
    return `Bu arayüz ${ours.appName} için derlendi ama sunucu hangi uygulama olduğunu bildirmedi (eski bir Reviewist sürümü olabilir). Sunucuyu \`${ours.startCommand}\` ile başlatın.`;
  }
  const theirs = INFO[server];
  return (
    `Bu arayüz ${ours.appName} için derlendi ama sunucu ${theirs.appName} olarak çalışıyor. ` +
    `${ours.appName} varsayılan olarak ${ours.defaultPort}, ${theirs.appName} ${theirs.defaultPort} portunda çalışır; ` +
    `arayüzü doğru sunucunun yazdığı adresten açın.`
  );
}
