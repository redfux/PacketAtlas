// Best-effort TLS handshake sniffing for the statistics view: reads the first
// handshake message of a TCP payload and, if it is a ClientHello or ServerHello,
// returns the negotiated protocol version and cipher suite. Only the very start
// of a TCP payload is looked at (no stream reassembly), which is enough for
// ServerHellos (small) - a ClientHello whose extensions are split over several
// segments simply yields less detail. Anything unexpected returns null.
// Loaded into the worker via importScripts() as a classic (non-module) script,
// so no import/export syntax here.
// thought up by human, created by ai

const TLS_VERSION_NAMES = { 0x0300: 'SSL 3.0', 0x0301: 'TLS 1.0', 0x0302: 'TLS 1.1', 0x0303: 'TLS 1.2', 0x0304: 'TLS 1.3' };

// Selected cipher suite -> [name, quality]. quality: 'weak' (broken primitives),
// 'nopfs' (static RSA key exchange, no forward secrecy), 'ok'. Only suites that
// show up in practice are listed, anything else is shown as its hex id.
const TLS_CIPHER_SUITES = {
  0x1301: ['TLS_AES_128_GCM_SHA256', 'ok'],
  0x1302: ['TLS_AES_256_GCM_SHA384', 'ok'],
  0x1303: ['TLS_CHACHA20_POLY1305_SHA256', 'ok'],
  0xc02b: ['ECDHE-ECDSA-AES128-GCM-SHA256', 'ok'],
  0xc02c: ['ECDHE-ECDSA-AES256-GCM-SHA384', 'ok'],
  0xc02f: ['ECDHE-RSA-AES128-GCM-SHA256', 'ok'],
  0xc030: ['ECDHE-RSA-AES256-GCM-SHA384', 'ok'],
  0xcca8: ['ECDHE-RSA-CHACHA20-POLY1305', 'ok'],
  0xcca9: ['ECDHE-ECDSA-CHACHA20-POLY1305', 'ok'],
  0x009e: ['DHE-RSA-AES128-GCM-SHA256', 'ok'],
  0x009f: ['DHE-RSA-AES256-GCM-SHA384', 'ok'],
  0xc009: ['ECDHE-ECDSA-AES128-SHA', 'ok'],
  0xc00a: ['ECDHE-ECDSA-AES256-SHA', 'ok'],
  0xc013: ['ECDHE-RSA-AES128-SHA', 'ok'],
  0xc014: ['ECDHE-RSA-AES256-SHA', 'ok'],
  0x0033: ['DHE-RSA-AES128-SHA', 'ok'],
  0x0039: ['DHE-RSA-AES256-SHA', 'ok'],
  0x009c: ['RSA-AES128-GCM-SHA256', 'nopfs'],
  0x009d: ['RSA-AES256-GCM-SHA384', 'nopfs'],
  0x003c: ['RSA-AES128-SHA256', 'nopfs'],
  0x003d: ['RSA-AES256-SHA256', 'nopfs'],
  0x002f: ['RSA-AES128-SHA', 'nopfs'],
  0x0035: ['RSA-AES256-SHA', 'nopfs'],
  0x000a: ['RSA-3DES-EDE-CBC-SHA', 'weak'],
  0x0005: ['RSA-RC4-128-SHA', 'weak'],
  0x0004: ['RSA-RC4-128-MD5', 'weak'],
};

function tlsVersionName(version) {
  return TLS_VERSION_NAMES[version] || `0x${version.toString(16).padStart(4, '0')}`;
}

/** SSL 3.0 / TLS 1.0 / TLS 1.1 - deprecated (RFC 8996). */
function isOutdatedTlsVersion(version) {
  return version >= 0x0300 && version <= 0x0302;
}

function tlsCipherInfo(id) {
  const known = TLS_CIPHER_SUITES[id];
  return known ? { name: known[0], quality: known[1] } : { name: `0x${id.toString(16).padStart(4, '0')}`, quality: 'ok' };
}

/** GREASE values (RFC 8701) are random placeholders of the form 0x?a?a and must be ignored. */
function isTlsGrease(value) {
  return (value & 0x0f0f) === 0x0a0a;
}

/**
 * Returns { kind: 'client' | 'server', version, cipher } or null.
 * `version` is the negotiated version for a ServerHello (supported_versions
 * extension if present, else the legacy version field) and the highest offered
 * version for a ClientHello (null if its extensions were not fully visible).
 */
function parseTlsHello(buffer, offset, length) {
  // Record header (5) + handshake header (4) + version (2) at minimum.
  if (length < 11) return null;
  const view = new DataView(buffer, offset, length);
  if (view.getUint8(0) !== 22 || view.getUint8(1) !== 3 || view.getUint8(2) > 4) return null;
  const handshakeType = view.getUint8(5);
  if (handshakeType !== 1 && handshakeType !== 2) return null;
  const legacyVersion = view.getUint16(9);
  if (legacyVersion < 0x0300 || legacyVersion > 0x0304) return null;

  const result = { kind: handshakeType === 2 ? 'server' : 'client', version: handshakeType === 2 ? legacyVersion : null, cipher: null, sni: null };
  try {
    let pos = 11 + 32; // skip the 32-byte random
    pos += 1 + view.getUint8(pos); // session id
    if (handshakeType === 2) {
      result.cipher = view.getUint16(pos);
      pos += 3; // cipher suite + compression method
    } else {
      pos += 2 + view.getUint16(pos); // cipher suites
      pos += 1 + view.getUint8(pos); // compression methods
    }
    const extensionsEnd = Math.min(length, pos + 2 + view.getUint16(pos));
    pos += 2;
    while (pos + 4 <= extensionsEnd) {
      const type = view.getUint16(pos);
      const extLength = view.getUint16(pos + 2);
      const body = pos + 4;
      if (type === 0x002b && body + extLength <= length) {
        if (handshakeType === 2 && extLength === 2) {
          result.version = view.getUint16(body); // selected version
        } else if (handshakeType === 1 && extLength >= 1) {
          let highest = 0;
          const listEnd = Math.min(body + 1 + view.getUint8(body), body + extLength);
          for (let p = body + 1; p + 2 <= listEnd; p += 2) {
            const v = view.getUint16(p);
            if (!isTlsGrease(v) && v > highest) highest = v;
          }
          if (highest) result.version = highest;
        }
      } else if (type === 0x0000 && handshakeType === 1 && extLength >= 5 && body + extLength <= length) {
        // server_name: list length (2), then { name type (1, 0 = host_name), length (2), name }.
        if (view.getUint8(body + 2) === 0) {
          const nameLength = view.getUint16(body + 3);
          if (nameLength > 0 && body + 5 + nameLength <= body + extLength) {
            let name = '';
            for (let i = 0; i < nameLength && i < 255; i++) name += String.fromCharCode(view.getUint8(body + 5 + i));
            result.sni = name.toLowerCase();
          }
        }
      }
      pos = body + extLength;
    }
  } catch {
    // Truncated by snaplen / segment boundary: keep whatever was found so far.
  }
  if (result.kind === 'client' && result.version === null) result.version = legacyVersion; // no supported_versions seen
  return result;
}
