// Synthetic captures used by the tests (see lib/pcap-builder.js for why they are generated).
// thought up by human, created by ai

import {
  CaptureBuilder, MAC_A, MAC_B, MAC_C, MAC_D, bpdu, cdpFrame, ethernet, ethernet8023, lldpFrame, mac, mdnsQuery, tlsClientHello, tlsServerHello, u16,
} from './lib/pcap-builder.js';

/** TCP quality: a clean flow, a flow with retransmits, one ended by RST, plus DNS and ICMP (incl. an error). */
export function qualityCapture() {
  const b = new CaptureBuilder({ start: 2_000_000 });
  b.tcpFlow('10.0.0.1', '10.0.0.2', 5000, 443, { rounds: 20, end: 'fin' });
  b.tcpFlow('10.0.0.1', '10.0.0.3', 5001, 8443, { rounds: 20, retransmitEvery: 2 });
  b.tcpFlow('10.0.0.1', '10.0.0.4', 5002, 22, { rounds: 6, end: 'rst' });
  b.dnsLookup('10.0.0.1', '10.0.0.53', 'www.example.com', { answers: [[93, 184, 216, 34]] });
  b.icmp('10.0.0.1', '10.0.0.2', 8);
  b.icmp('10.0.0.2', '10.0.0.1', 0);
  b.icmp('10.0.0.2', '10.0.0.1', 3, 3);
  b.icmp('10.0.0.2', '10.0.0.1', 3, 3);
  b.arpRequest('10.0.0.1', '10.0.0.9');
  return b.build();
}

/** Layer 2, DNS resolvers, iCloud Private Relay, Apple traffic, TLS hellos, DoT and mDNS in one small capture. */
export function servicesCapture() {
  const b = new CaptureBuilder({ start: 2_100_000 });
  const C1 = '10.0.0.1';
  const C2 = '10.0.0.2';
  const C3 = '10.0.0.3';
  const PRIVATE_DNS = '10.0.0.53';
  const UMBRELLA = '208.67.222.222';
  const GOOGLE = '8.8.8.8';

  // Layer 2: STP config with topology change, TCN, PVST+ (VLAN 20), CDP, LLDP, LACP (not in sync), EAPOL (tagged), unknown Ethertype.
  const llc = (...bytes) => Buffer.from(bytes);
  b.frame(ethernet8023('01:80:c2:00:00:00', MAC_A, Buffer.concat([llc(0x42, 0x42, 0x03), bpdu({ topologyChange: true, root: { priority: 0x8000, mac: MAC_A }, bridge: { priority: 0x8000, mac: MAC_A } })])));
  b.frame(ethernet8023('01:80:c2:00:00:00', MAC_B, Buffer.concat([llc(0x42, 0x42, 0x03), Buffer.from([0, 0, 0, 0x80])])));
  b.frame(ethernet8023('01:00:0c:cc:cc:cd', MAC_B, Buffer.concat([llc(0xaa, 0xaa, 0x03, 0, 0, 0x0c, 0x01, 0x0b), bpdu({ root: { priority: 0x8014, mac: MAC_A }, bridge: { priority: 0x8014, mac: MAC_B } }), u16(0), u16(2), u16(20)])));
  b.frame(ethernet8023('01:00:0c:cc:cc:cc', MAC_A, Buffer.concat([llc(0xaa, 0xaa, 0x03, 0, 0, 0x0c, 0x20, 0x00), cdpFrame({ deviceId: 'SW1.lab', portId: 'GigabitEthernet1/0/1', platform: 'cisco WS-C2960X-24TS-L', mgmtIp: '10.0.0.250' })])));
  b.frame(ethernet('01:80:c2:00:00:0e', MAC_B, 0x88cc, lldpFrame({ chassisMac: MAC_B, portId: 'Gi1/0/24', systemName: 'AP-Flur-2', mgmtIp: '10.0.0.251' })));
  b.frame(ethernet('01:80:c2:00:00:02', MAC_A, 0x8809, Buffer.concat([Buffer.from([1, 1, 1, 20]), u16(0x8000), mac(MAC_A), u16(1), u16(0x8000), u16(1), Buffer.from([0x45, 0, 0, 0]), Buffer.alloc(30)])));
  b.frame(ethernet('01:80:c2:00:00:03', MAC_C, 0x888e, Buffer.alloc(30), 30));
  b.frame(ethernet(MAC_D, MAC_C, 0x1234, Buffer.alloc(20)));

  // DNS: managed (private) resolver, a public one on top (bypass hint), Apple names.
  b.dnsLookup(C1, PRIVATE_DNS, 'www.example.com', { answers: [[93, 184, 216, 34]] });
  b.dnsLookup(C1, PRIVATE_DNS, 'init.push.apple.com', { answers: [[17, 57, 144, 10]] });
  b.dnsLookup(C1, PRIVATE_DNS, 'swscan.apple.com', { answers: [[17, 253, 1, 1]] });
  b.dnsLookup(C1, PRIVATE_DNS, 'captive.apple.com', { answers: [[17, 253, 1, 2]] });
  b.dnsLookup(C1, GOOGLE, 'www.example.org', { answers: [[93, 184, 216, 35]] });

  // Private Relay names asked through Umbrella: block page, NXDOMAIN, NODATA, a real address (learned as relay address).
  b.dnsLookup(C1, UMBRELLA, 'mask.icloud.com', { answers: [[146, 112, 61, 106]] });
  b.dnsLookup(C1, UMBRELLA, 'mask-h2.icloud.com', { rcode: 3 });
  b.dnsLookup(C1, UMBRELLA, 'mask-api.icloud.com', {});
  b.dnsLookup(C1, UMBRELLA, 'mask.apple-dns.net', { answers: [[17, 253, 144, 10]] });
  for (let i = 0; i < 6; i++) b.dnsLookup(C2, UMBRELLA, 'mask.icloud.com', { answers: [[146, 112, 61, 106]], gap: 2.5 });
  b.dnsLookup(C2, UMBRELLA, 'mask-h2.icloud.com', { answer: false });
  b.dnsLookup(C2, UMBRELLA, 'api.example.com', { rcode: 2 });

  // Traffic towards the learned relay address (QUIC), Apple push, NTP.
  b.udp(C1, '17.253.144.10', 50000, 443, Buffer.alloc(1200));
  b.udp('17.253.144.10', C1, 443, 50000, Buffer.alloc(1200));
  b.tcp(C1, '17.57.144.1', 51000, 5223, Buffer.alloc(100));
  b.udp(C1, '17.253.34.125', 51001, 123, Buffer.alloc(48));

  // TLS: ClientHellos with SNI, ServerHellos of different versions (TLS 1.0 with a static-RSA suite is "outdated").
  b.tcp(C3, '17.253.144.10', 52000, 443, tlsClientHello({ sni: 'mask.icloud.com' }));
  b.tcp(C3, '17.253.1.1', 52001, 443, tlsClientHello({ sni: 'www.apple.com' }));
  b.tcp(C1, '10.0.0.20', 53100, 443, tlsClientHello({}));
  b.tcp('10.0.0.20', C1, 443, 53100, tlsServerHello({ cipher: 0x1302, selectedVersion: 0x0304 }));
  b.tcp(C1, '10.0.0.21', 53101, 443, tlsClientHello({}));
  b.tcp('10.0.0.21', C1, 443, 53101, tlsServerHello({ cipher: 0xc02f }));
  b.tcp(C1, '10.0.0.22', 53102, 8443, tlsClientHello({ versions: [0x0301] }));
  b.tcp('10.0.0.22', C1, 8443, 53102, tlsServerHello({ legacy: 0x0301, cipher: 0x0035 }));

  // DoT / DoH-suspect traffic and mDNS.
  b.tcp(C1, '1.1.1.1', 53000, 853, Buffer.alloc(80));
  b.tcp(C1, GOOGLE, 53001, 443, Buffer.alloc(80));
  b.udp(C1, '224.0.0.251', 5353, 5353, mdnsQuery(['_airplay._tcp.local', '_googlecast._tcp.local']), { dstMac: '01:00:5e:00:00:fb', srcMac: MAC_C });
  return b.build();
}

/** A UDP datagram split into two IPv4 fragments, to cover the fragmentation facet. */
export function fragmentCapture() {
  const b = new CaptureBuilder({ start: 2_200_000 });
  const payload = Buffer.alloc(1480);
  payload.writeUInt16BE(1000, 0);
  payload.writeUInt16BE(2000, 2);
  b.frame(ethernet(MAC_B, MAC_A, 0x0800, ipv4Raw('3.3.3.3', '4.4.4.4', 17, payload, 0x2000)));
  b.frame(ethernet(MAC_B, MAC_A, 0x0800, ipv4Raw('3.3.3.3', '4.4.4.4', 17, Buffer.alloc(200), 185)));
  b.udp('3.3.3.3', '4.4.4.4', 1000, 2000, Buffer.alloc(40));
  return b.build();
}

function ipv4Raw(src, dst, protocol, l4, flagsFragment) {
  const header = Buffer.alloc(20);
  header[0] = 0x45;
  header.writeUInt16BE(20 + l4.length, 2);
  header.writeUInt16BE(flagsFragment, 6);
  header[8] = 64;
  header[9] = protocol;
  src.split('.').forEach((o, i) => { header[12 + i] = Number(o); });
  dst.split('.').forEach((o, i) => { header[16 + i] = Number(o); });
  return Buffer.concat([header, l4]);
}

export const FIXTURES = {
  quality: qualityCapture,
  services: servicesCapture,
  fragments: fragmentCapture,
};
