import fs from 'fs';
import path from 'path';
import nock from 'nock';
import { TestHelpers } from '../test-helpers';
import XmlHelper from '../../src/helpers/xml-helper';
import MetadataHelper from '../../src/helpers/metadata-helper';
import { ZoneGroupTopologyService } from '../../src/services/zone-group-topology.service.extension';
import { ContentDirectoryService } from '../../src/services/content-directory.service.extension';
import { AlarmClockService } from '../../src/services/alarm-clock.service.extension';
import { MusicServicesService } from '../../src/services/music-services.service.extension';
import { AVTransportService } from '../../src/services/av-transport.service';
import { RenderingControlService } from '../../src/services/rendering-control.service.extension';
import { QueueService } from '../../src/services/queue.service';
import { DevicePropertiesService } from '../../src/services/device-properties.service';
import { AVTRANSPORT_LASTCHANGE_NOTIFY } from './avtransport-lastchange.fixture';

/**
 * Captured-payload corpus + snapshot tripwire.
 *
 * Each manifest entry is a REAL Sonos payload (lifted verbatim from existing fixtures /
 * service tests) run through its genuine parse path, then locked with toMatchSnapshot().
 * The repo is on fast-xml-parser 4.5.6, so these snapshots pin the known-good v4 output:
 * any future dependency bump or firmware change that alters parsing surfaces as an exact
 * snapshot diff. Targeted, snapshot-independent invariants (no NaN, string-typed URIs/UUIDs,
 * no entity-mangled album art) back-stop the snapshots against silent coercion drift.
 */
const HOST = TestHelpers.testHost;
const PORT = 1400;
const CORPUS_DIR = path.join(__dirname, 'corpus');

function readCorpus(file: string): string {
  return fs.readFileSync(path.join(CORPUS_DIR, file)).toString();
}

type ParsePath = 'zgt' | 'event' | 'didl-track' | 'didl-lite' | 'browse' | 'alarm' | 'music' | 'soap';

interface ManifestEntry {
  id: string;
  path: ParsePath;
  file?: string;
  useFixture?: boolean;
  service?: string;
  objectId?: string;
}

const MANIFEST: ManifestEntry[] = [
  // ZoneGroupTopology GetZoneGroupState -> GetParsedZoneGroupState() over a nock SOAP response.
  { id: 'zgt-normal-three-members', path: 'zgt', file: 'zgt.normal.xml' },
  { id: 'zgt-stereo-bonded-pair', path: 'zgt', file: 'zgt.stereo.xml' },
  { id: 'zgt-channelmap-two-zones', path: 'zgt', file: 'zgt.channelmap-normal.xml' },

  // LastChange / event NOTIFY bodies -> Service.ParseEvent(), capturing the emitted serviceEvent.
  { id: 'event-avtransport-spotify-current-next', path: 'event', useFixture: true, service: 'AVTransport' },
  { id: 'event-rendering-control-rcs', path: 'event', file: 'event.rendering-control-rcs.xml', service: 'RenderingControl' },
  { id: 'event-queue-multiple-queueids', path: 'event', file: 'event.queue.xml', service: 'Queue' },
  { id: 'event-device-properties-zoneattributes', path: 'event', file: 'event.device-properties.xml', service: 'DeviceProperties' },

  // DIDL single-track metadata -> MetadataHelper.ParseDIDLTrack(XmlHelper.DecodeAndParseXml(x)).
  { id: 'didl-track-spotify-apostrophe', path: 'didl-track', file: 'didl.track-christmas-apos.xml' },
  { id: 'didl-track-spotify-noizu', path: 'didl-track', file: 'didl.track-noizu.xml' },

  // Same payload through the raw XmlHelper.DecodeAndParseXml(x)['DIDL-Lite'] path (no &amp; strip).
  { id: 'didl-lite-raw-spotify-apostrophe', path: 'didl-lite', file: 'didl.track-christmas-apos.xml' },

  // ContentDirectory Browse Result -> BrowseParsedWithDefaults() over a nock SOAP response (Track[]).
  { id: 'browse-artist-eminem-filecifs-art', path: 'browse', file: 'browse.eminem-artist.xml', objectId: 'A:ARTIST/eminem' },
  { id: 'browse-search-eminem-ampersand-titles', path: 'browse', file: 'browse.eminem-search.xml', objectId: 'A:ARTIST:eminem' },
  { id: 'browse-radio-stations-audiobroadcast', path: 'browse', file: 'browse.radio-stations.xml', objectId: 'R:0/0' },
  { id: 'browse-favorites-nested-resmd', path: 'browse', file: 'browse.favorites.xml', objectId: 'FV:2' },
  { id: 'browse-queue-70-tracks', path: 'browse', file: 'browse.queue.xml', objectId: 'Q:0' },

  // AlarmClock ListAlarms -> ListAndParseAlarms() over a nock SOAP response (Alarm[] with nested DIDL).
  { id: 'alarm-list-with-program-metadata', path: 'alarm', file: 'alarm.list-alarms.xml' },

  // MusicServices ListAvailableServices -> ListAndParseAvailableServices() over a nock SOAP response.
  { id: 'music-available-services', path: 'music', file: 'music.list-available-services.xml' },

  // Generic SOAP / XML envelope through the centralized v4 wrapper XmlHelper.parse().
  { id: 'soap-device-description', path: 'soap', file: 'soap.device-description.xml' },
];

function makeEventService(name: string): any {
  switch (name) {
    case 'AVTransport': return new AVTransportService(HOST, PORT);
    case 'RenderingControl': return new RenderingControlService(HOST, PORT);
    case 'Queue': return new QueueService(HOST, PORT);
    case 'DeviceProperties': return new DevicePropertiesService(HOST, PORT);
    default: throw new Error(`Unknown event service: ${name}`);
  }
}

function captureServiceEvent(serviceName: string, payload: string): any {
  const service = makeEventService(serviceName);
  let captured: any;
  service.Events.once('serviceEvent', (data: any) => { captured = data; });
  service.ParseEvent(payload);
  return captured;
}

async function runParsePath(entry: ManifestEntry): Promise<any> {
  switch (entry.path) {
    case 'zgt':
      TestHelpers.mockRequest(
        '/ZoneGroupTopology/Control',
        '"urn:schemas-upnp-org:service:ZoneGroupTopology:1#GetZoneGroupState"',
        '<u:GetZoneGroupState xmlns:u="urn:schemas-upnp-org:service:ZoneGroupTopology:1"></u:GetZoneGroupState>',
        'GetZoneGroupStateResponse',
        'ZoneGroupTopology',
        readCorpus(entry.file as string),
      );
      return new ZoneGroupTopologyService(HOST, PORT).GetParsedZoneGroupState();

    case 'event':
      return captureServiceEvent(
        entry.service as string,
        entry.useFixture ? AVTRANSPORT_LASTCHANGE_NOTIFY : readCorpus(entry.file as string),
      );

    case 'didl-track':
      return MetadataHelper.ParseDIDLTrack(XmlHelper.DecodeAndParseXml(readCorpus(entry.file as string)), HOST, PORT);

    case 'didl-lite':
      return (XmlHelper.DecodeAndParseXml(readCorpus(entry.file as string)) as { [key: string]: any })['DIDL-Lite'];

    case 'browse': {
      const objectId = entry.objectId as string;
      TestHelpers.mockRequestToService(
        '/MediaServer/ContentDirectory/Control',
        'ContentDirectory',
        'Browse',
        `<ObjectID>${objectId}</ObjectID><BrowseFlag>BrowseDirectChildren</BrowseFlag><Filter>*</Filter><StartingIndex>0</StartingIndex><RequestedCount>0</RequestedCount><SortCriteria></SortCriteria>`,
        readCorpus(entry.file as string),
      );
      return new ContentDirectoryService(HOST, PORT).BrowseParsedWithDefaults(objectId);
    }

    case 'alarm':
      TestHelpers.mockRequest(
        '/AlarmClock/Control',
        '"urn:schemas-upnp-org:service:AlarmClock:1#ListAlarms"',
        '<u:ListAlarms xmlns:u="urn:schemas-upnp-org:service:AlarmClock:1"></u:ListAlarms>',
        'ListAlarmsResponse',
        'AlarmClock',
        readCorpus(entry.file as string),
      );
      return new AlarmClockService(HOST, PORT).ListAndParseAlarms();

    case 'music':
      TestHelpers.mockRequest(
        '/MusicServices/Control',
        '"urn:schemas-upnp-org:service:MusicServices:1#ListAvailableServices"',
        '<u:ListAvailableServices xmlns:u="urn:schemas-upnp-org:service:MusicServices:1"></u:ListAvailableServices>',
        'ListAvailableServicesResponse',
        'MusicServices',
        readCorpus(entry.file as string),
      );
      return new MusicServicesService(HOST, PORT).ListAndParseAvailableServices();

    case 'soap':
      return XmlHelper.parse(readCorpus(entry.file as string));

    default:
      throw new Error(`Unknown parse path: ${entry.path}`);
  }
}

const URI_KEYS = new Set(['TrackUri', 'AlbumArtUri', 'uuid']);

function assertDecodedInvariants(decoded: any): void {
  const walk = (value: any): void => {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (typeof value === 'number') {
      expect(Number.isNaN(value)).toBe(false);
      return;
    }
    if (typeof value !== 'object') return;

    Object.entries(value).forEach(([key, val]) => {
      if ((URI_KEYS.has(key) || key.endsWith('UUID')) && val !== undefined && val !== null) {
        expect(typeof val).toBe('string');
      }
      if (key === 'AlbumArtUri' && typeof val === 'string') {
        expect(val.includes('&amp;')).toBe(false);
      }
      walk(val);
    });
  };
  walk(decoded);
}

describe('firmware-tripwire: captured-payload corpus (fast-xml-parser v4 baseline)', () => {
  beforeAll(() => {
    process.env.SONOS_DISABLE_EVENTS = 'true';
  });

  afterAll(() => {
    delete process.env.SONOS_DISABLE_EVENTS;
  });

  afterEach(() => {
    nock.cleanAll();
  });

  test('every manifest entry maps to an existing corpus payload', () => {
    MANIFEST.filter((e) => !e.useFixture).forEach((entry) => {
      expect(fs.existsSync(path.join(CORPUS_DIR, entry.file as string))).toBe(true);
    });
    expect(MANIFEST.length).toBeGreaterThanOrEqual(12);
  });

  test.each(MANIFEST.map((entry) => [`${entry.id} [${entry.path}]`, entry] as [string, ManifestEntry]))(
    '%s parses to a stable v4 snapshot with no coercion drift',
    async (_label, entry) => {
      const decoded = await runParsePath(entry);

      expect(decoded).not.toBeUndefined();
      expect(decoded).toMatchSnapshot();
      assertDecodedInvariants(decoded);
    },
  );
});
