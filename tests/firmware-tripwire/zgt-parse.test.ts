import nock from 'nock';
import { TestHelpers } from '../test-helpers';
import { ZoneGroupTopologyService } from '../../src/services/zone-group-topology.service.extension';

/**
 * Firmware / dependency tripwire.
 *
 * Locks the parsed output of real captured GetZoneGroupState payloads as produced by
 * fast-xml-parser 3.19.0 (parseAttributeValue defaults false -> every attribute is a
 * string, no number coercion). The upcoming v3 -> v4 swap must not silently change any
 * of these values. Driven through the genuine library path: ZoneGroupTopologyService
 * .GetParsedZoneGroupState() over a nock-mocked SOAP response, the same path consumers
 * (and the proxy) depend on.
 */
describe('Firmware tripwire: ZoneGroupTopology parse (fast-xml-parser v3 baseline)', () => {
  beforeAll(() => {
    process.env.SONOS_DISABLE_EVENTS = 'true';
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe('zone-group.GroupState.xml (single group, three members)', () => {
    test('locks group structure, coordinator and member UUIDs as exact strings', async () => {
      TestHelpers.mockZoneGroupState(TestHelpers.getScope(), 'zone-group.GroupState.xml');
      const service = new ZoneGroupTopologyService(TestHelpers.testHost, 1400);

      const groups = await service.GetParsedZoneGroupState();

      expect(groups).toHaveLength(1);
      const group = groups[0];

      expect(group.groupId).toBe('RINCON_000FFFFFF42C01400:63');
      expect(typeof group.groupId).toBe('string');

      expect(group.coordinator.uuid).toBe('RINCON_000FFFFFF42C01400');
      expect(typeof group.coordinator.uuid).toBe('string');
      expect(group.coordinator.name).toBe('Keuken');
      expect(group.name).toBe('Keuken + 2');

      expect(group.members).toHaveLength(3);

      const uuids = group.members.map((m) => m.uuid);
      expect(uuids).toEqual([
        'RINCON_000FFFFFF42C01400',
        'RINCON_000FFFFFF4AA01400',
        'RINCON_000FFFFFF4CC01400',
      ]);
      uuids.forEach((u) => expect(typeof u).toBe('string'));

      expect(group.members.map((m) => m.name)).toEqual(['Keuken', 'TV', 'Eetkamer']);

      expect(group.members.map((m) => m.host)).toEqual([
        '192.168.1.20',
        '192.168.1.21',
        '192.168.1.22',
      ]);
      expect(group.members[0].port).toBe(1400);
      expect(typeof group.members[0].port).toBe('number');

      group.members.forEach((m) => expect(m.ChannelMapSet).toBeUndefined());

      expect(group.members[0].SoftwareVersion).toBe('55.1-74250');
      expect(group.members[0].SwGen).toBe('1');
      expect(typeof group.members[0].SwGen).toBe('string');

      expect(group.members[0].MicEnabled).toBe(false);
      expect(group.members[0].WifiEnabled).toBe(true);
      expect(group.members[0].Invisible).toBe(false);
      expect(group.members[0].HdmiCecAvailable).toBe(false);
      expect(group.members[0].HasConfiguredSSID).toBe(false);
      expect(group.members[0].TVConfigurationError).toBe(0);
    });
  });

  describe('zone-group.GroupState.ChannelMapSet.stereo.xml (bonded stereo pair)', () => {
    test('stereo pair stays one group with two bonded members and ChannelMapSet resolves both UUIDs', async () => {
      TestHelpers.mockZoneGroupState(TestHelpers.getScope(), 'zone-group.GroupState.ChannelMapSet.stereo.xml');
      const service = new ZoneGroupTopologyService(TestHelpers.testHost, 1400);

      const groups = await service.GetParsedZoneGroupState();

      expect(groups).toHaveLength(1);
      const group = groups[0];

      expect(group.groupId).toBe('RINCON_FFFFFFFFFFFFFFFF0:123456789');

      expect(group.members).toHaveLength(2);
      expect(group.members.map((m) => m.uuid)).toEqual([
        'RINCON_FFFFFFFFF0000FFF0',
        'RINCON_FFFFFFFFFFFFFFFF0',
      ]);

      expect(group.coordinator.uuid).toBe('RINCON_FFFFFFFFFFFFFFFF0');
      expect(group.coordinator.name).toBe('Office');
      expect(group.name).toBe('Office + 1');

      expect(group.members[0].Invisible).toBe(true);
      expect(group.members[1].Invisible).toBe(false);

      const expectedMap = { LF: 'RINCON_FFFFFFFFFFFFFFFF0', RF: 'RINCON_FFFFFFFFF0000FFF0' };
      expect(group.members[0].ChannelMapSet).toEqual(expectedMap);
      expect(group.members[1].ChannelMapSet).toEqual(expectedMap);

      expect(typeof group.members[0].ChannelMapSet!.LF).toBe('string');
      expect(typeof group.members[0].ChannelMapSet!.RF).toBe('string');
    });
  });

  describe('zone-group.GroupState.ChannelMapSet.normal.xml (two unbonded zones grouped)', () => {
    test('non-bonded members keep exact UUIDs and names and carry no ChannelMapSet', async () => {
      TestHelpers.mockZoneGroupState(TestHelpers.getScope(), 'zone-group.GroupState.ChannelMapSet.normal.xml');
      const service = new ZoneGroupTopologyService(TestHelpers.testHost, 1400);

      const groups = await service.GetParsedZoneGroupState();

      expect(groups).toHaveLength(1);
      const group = groups[0];

      expect(group.members).toHaveLength(2);
      expect(group.members.map((m) => m.uuid)).toEqual([
        'RINCON_FFFFFFFFFFFFFFFF0',
        'RINCON_FFFFFFFF000000000',
      ]);
      expect(group.members.map((m) => m.name)).toEqual(['Kitchen', 'Living Room']);

      expect(group.coordinator.uuid).toBe('RINCON_FFFFFFFFFFFFFFFF0');
      expect(group.name).toBe('Kitchen + 1');

      group.members.forEach((m) => expect(m.ChannelMapSet).toBeUndefined());
    });
  });
});
