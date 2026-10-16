// Versioned reference lists and small matchers the statistics use to put names
// on things: which DNS server is this, is this traffic Apple's, is this name
// part of iCloud Private Relay. The lists are DATA - to adjust a detection,
// edit the tables at the top, not the functions below, and bump the date.
// Everything here is a heuristic over unencrypted metadata (addresses, ports,
// DNS and TLS names); it can be wrong in both directions (shared CDN addresses,
// new Apple services, resolver anycast ranges that change) and is labelled that
// way in the UI. There is deliberately no online lookup: the page's CSP forbids
// any network connection.
// Loaded into the worker via importScripts() as a classic (non-module) script,
// so no import/export syntax here.
// thought up by human, created by ai

const CLASSIFICATION_VERSION = '2026-10-16';

/*
 * Sources
 * - Apple: "Prepare your network or content filter for iCloud Private Relay"
 *   (developer.apple.com/support/prepare-your-network-for-icloud-private-relay):
 *   hostnames mask.icloud.com / mask-h2.icloud.com, answer NXDOMAIN or NODATA
 *   to switch it off, avoid timeouts; QUIC (UDP 443) with TLS 1.3.
 * - Cisco: "Enable Cisco Umbrella with iCloud Private Relay"
 *   (cisco.com doc 224824): same two names, allow list additionally contains
 *   mask-api.icloud.com and mask.apple-dns.net; with the NODATA override a
 *   content-category match answers with a block page IP, which makes
 *   macOS/iOS clients time out.
 * - Resolver addresses: the providers' public documentation.
 * - 146.112.0.0/16 as Cisco Umbrella (OpenDNS) address space / block pages is
 *   operational knowledge, not stated in the Cisco document above - verify.
 */

// ---------------------------------------------------------------- DNS servers

// category -> { label, ips }. IPv6 addresses in the compressed lower-case form
// packet-decoder.js produces.
const DNS_PROVIDERS = {
  umbrella: {
    label: 'Cisco Umbrella / OpenDNS',
    ips: [
      '208.67.222.222', '208.67.220.220', '208.67.222.220', '208.67.220.222',
      '208.67.222.123', '208.67.220.123',
      '2620:119:35::35', '2620:119:53::53', '2620:0:ccc::2', '2620:0:ccd::2',
    ],
  },
  google: {
    label: 'Google Public DNS',
    ips: ['8.8.8.8', '8.8.4.4', '2001:4860:4860::8888', '2001:4860:4860::8844'],
  },
  cloudflare: {
    label: 'Cloudflare',
    ips: [
      '1.1.1.1', '1.0.0.1', '1.1.1.2', '1.0.0.2', '1.1.1.3', '1.0.0.3',
      '2606:4700:4700::1111', '2606:4700:4700::1001', '2606:4700:4700::1112', '2606:4700:4700::1002',
      '2606:4700:4700::1113', '2606:4700:4700::1003',
    ],
  },
  quad9: {
    label: 'Quad9',
    ips: [
      '9.9.9.9', '149.112.112.112', '9.9.9.10', '149.112.112.10', '9.9.9.11', '149.112.112.11', '9.9.9.12', '149.112.112.12',
      '2620:fe::fe', '2620:fe::9', '2620:fe::10', '2620:fe::11', '2620:fe::fe:10', '2620:fe::fe:11',
    ],
  },
  adguard: {
    label: 'AdGuard DNS',
    ips: ['94.140.14.14', '94.140.15.15', '94.140.14.140', '94.140.14.141', '94.140.14.15', '94.140.15.16', '2a10:50c0::ad1:ff', '2a10:50c0::ad2:ff'],
  },
  cleanbrowsing: {
    label: 'CleanBrowsing',
    ips: ['185.228.168.9', '185.228.169.9', '185.228.168.10', '185.228.169.11', '185.228.168.168', '185.228.169.168'],
  },
};

// Categories that are not an address list.
const DNS_CATEGORY_LABELS = {
  umbrella: DNS_PROVIDERS.umbrella.label,
  google: DNS_PROVIDERS.google.label,
  cloudflare: DNS_PROVIDERS.cloudflare.label,
  quad9: DNS_PROVIDERS.quad9.label,
  adguard: DNS_PROVIDERS.adguard.label,
  cleanbrowsing: DNS_PROVIDERS.cleanbrowsing.label,
  apple: 'Apple (17.0.0.0/8)',
  private: 'Privater DNS (RFC 1918 / ULA / Loopback)',
  public: 'Sonstiger öffentlicher DNS',
};

// Address space Cisco Umbrella (OpenDNS) answers with for blocked names (block page).
const UMBRELLA_BLOCK_PAGE_PREFIXES = ['146.112.'];

const APPLE_NET = { base: '17.0.0.0', bits: 8 };

// ------------------------------------------------------------------ Apple names

// Ordered: the first match wins, so the specific groups come before the catch-alls.
const APPLE_NAME_RULES = [
  [/^mask(-[a-z0-9]+)*\.icloud\.com$/, 'iCloud Private Relay'],
  [/(^|\.)apple-dns\.net$/, 'iCloud Private Relay'],
  [/(^|\.)push\.apple\.com$/, 'Push (APNs)'],
  [/(^|\.)captive\.apple\.com$/, 'Captive-Portal-Prüfung'],
  [/(^|\.)time[0-9a-z-]*\.apple\.com$/, 'Zeitdienst'],
  [/(^|\.)(swscan|swcdn|swdist|swdownload|mesu|updates|gdmf|oscdn)\.apple\.com$/, 'Software-Updates'],
  [/(^|\.)(ocsp[0-9]*|valid|crl)\.apple\.com$/, 'Zertifikatsprüfung (OCSP)'],
  [/(^|\.)(icloud\.com|icloud-content\.com|apple-cloudkit\.com)$/, 'iCloud'],
  [/(^|\.)(itunes\.apple\.com|apps\.apple\.com|mzstatic\.com)$/, 'App Store / iTunes'],
  [/(^|\.)(cdn-apple\.com|aaplimg\.com)$/, 'Apple CDN'],
  [/(^|\.)apple\.com$/, 'Sonstige Apple-Dienste'],
];

// mDNS service types that are typical for Apple devices.
const APPLE_MDNS_SERVICES = new Set([
  '_airplay._tcp', '_raop._tcp', '_companion-link._tcp', '_homekit._tcp', '_hap._tcp', '_apple-mobdev2._tcp',
  '_device-info._tcp', '_sleep-proxy._udp', '_afpovertcp._tcp', '_daap._tcp', '_dacp._tcp', '_touch-able._tcp',
  '_mediaremotetv._tcp', '_rdlink._tcp', '_apple-midi._udp', '_airdrop._tcp', '_remotepairing._tcp', '_atc._tcp',
]);

// ---------------------------------------------------------------- Private Relay

// The names Apple (and Cisco) document for iCloud Private Relay, plus the same
// naming pattern (mask-canary, ...). Matching by pattern also catches names no
// list knows yet.
const PRIVATE_RELAY_NAME = /^mask(-[a-z0-9]+)*\.icloud\.com$|^mask(-[a-z0-9]+)*\.apple-dns\.net$/;

// ---------------------------------------------------------------------- helpers

function normalizeDnsName(name) {
  return String(name || '').toLowerCase().replace(/\.$/, '');
}

function ipv4ToInt(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    value = value * 256 + n;
  }
  return value;
}

function ipv4InNet(ip, base, bits) {
  const value = ipv4ToInt(ip);
  const baseValue = ipv4ToInt(base);
  if (value === null || baseValue === null) return false;
  const size = Math.pow(2, 32 - bits);
  return Math.floor(value / size) === Math.floor(baseValue / size);
}

function isAppleAddress(ip) {
  return Boolean(ip) && ip.indexOf(':') === -1 && ipv4InNet(ip, APPLE_NET.base, APPLE_NET.bits);
}

/** RFC 1918, CGNAT, link-local and loopback for IPv4; ULA, link-local and loopback for IPv6. */
function isPrivateAddress(ip) {
  if (!ip) return false;
  if (ip.indexOf(':') !== -1) {
    if (ip === '::1') return true;
    const first = parseInt(ip.split(':')[0] || '0', 16);
    return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80;
  }
  return (
    ipv4InNet(ip, '10.0.0.0', 8) ||
    ipv4InNet(ip, '172.16.0.0', 12) ||
    ipv4InNet(ip, '192.168.0.0', 16) ||
    ipv4InNet(ip, '100.64.0.0', 10) ||
    ipv4InNet(ip, '169.254.0.0', 16) ||
    ipv4InNet(ip, '127.0.0.0', 8)
  );
}

const DNS_PROVIDER_BY_IP = (() => {
  const map = new Map();
  for (const [category, provider] of Object.entries(DNS_PROVIDERS)) {
    for (const ip of provider.ips) map.set(ip, category);
  }
  return map;
})();

/** { category, label } for the address of a DNS server. */
function classifyResolver(ip) {
  let category = DNS_PROVIDER_BY_IP.get(ip);
  if (!category) {
    if (isAppleAddress(ip)) category = 'apple';
    else if (isPrivateAddress(ip)) category = 'private';
    else category = 'public';
  }
  return { category, label: DNS_CATEGORY_LABELS[category] };
}

/**
 * Resolver categories that are NOT the usual "managed" ones (private DNS or
 * Cisco Umbrella). A client that talks to one of these in addition to a
 * managed resolver is a candidate for bypassing the DNS filtering.
 */
function isAlternativeResolverCategory(category) {
  return category !== 'private' && category !== 'umbrella';
}

function isPrivateRelayName(name) {
  return PRIVATE_RELAY_NAME.test(normalizeDnsName(name));
}

function isUmbrellaBlockPageAddress(ip) {
  return UMBRELLA_BLOCK_PAGE_PREFIXES.some((prefix) => ip.indexOf(prefix) === 0);
}

/** Apple service group for a DNS/SNI name, or null for names that have nothing to do with Apple. */
function classifyAppleName(name) {
  const normalized = normalizeDnsName(name);
  for (const [pattern, group] of APPLE_NAME_RULES) {
    if (pattern.test(normalized)) return group;
  }
  return null;
}

const APPLE_AIRPLAY_PORTS = new Set([7000, 7001, 7100]);

/**
 * Apple traffic group for one decoded packet by address and port, or null.
 * Returns { group, client } where `client` is the address the traffic is
 * attributed to (the non-Apple side where one exists).
 */
function classifyApplePacket(decoded) {
  const { protocol, srcIp, dstIp, srcPort, dstPort } = decoded;
  if (protocol !== 'TCP' && protocol !== 'UDP') return null;
  const either = (port) => srcPort === port || dstPort === port;

  if (protocol === 'UDP' && either(5353)) return { group: 'Bonjour / mDNS', client: srcIp };

  const srcApple = isAppleAddress(srcIp);
  const dstApple = isAppleAddress(dstIp);
  const appleSide = srcApple || dstApple;
  const client = srcApple ? dstIp : srcIp;

  if (protocol === 'TCP' && either(5223)) return { group: 'Push (APNs)', client };
  if (protocol === 'TCP' && (APPLE_AIRPLAY_PORTS.has(srcPort) || APPLE_AIRPLAY_PORTS.has(dstPort))) return { group: 'AirPlay (TCP 7000/7001/7100)', client };
  if (!appleSide) return null;

  if (protocol === 'UDP' && either(123)) return { group: 'Zeitdienst (NTP)', client };
  if (protocol === 'UDP') {
    const inStunRange = (port) => (port >= 3478 && port <= 3497) || (port >= 16384 && port <= 16387) || (port >= 16393 && port <= 16402);
    if (inStunRange(srcPort) || inStunRange(dstPort)) return { group: 'FaceTime / iMessage (STUN/RTP)', client };
    if (either(443)) return { group: 'QUIC zu Apple (UDP 443)', client };
  } else {
    if (either(443)) return { group: 'HTTPS zu Apple (TCP 443)', client };
    if (either(80)) return { group: 'HTTP zu Apple (TCP 80)', client };
  }
  return { group: 'Sonstiger Apple-Verkehr (17.0.0.0/8)', client };
}
