import { expect } from 'chai';
import { AVTransportService } from '../../src/services/av-transport.service';
import { Track } from '../../src/models/track';
import { TestHelpers } from '../test-helpers';
import { AVTRANSPORT_LASTCHANGE_NOTIFY } from './avtransport-lastchange.fixture';

const HOST = TestHelpers.testHost;
const PORT = 1400;

function parseLastChange(): { Current: Track; Next: Track } {
  process.env.SONOS_DISABLE_EVENTS = 'true';
  const service = new AVTransportService(HOST, PORT);
  let captured: any;
  service.Events.once('serviceEvent', (data) => {
    captured = data;
  });
  service.ParseEvent(AVTRANSPORT_LASTCHANGE_NOTIFY);
  delete process.env.SONOS_DISABLE_EVENTS;
  return { Current: captured.CurrentTrackMetaData, Next: captured.NextTrackMetaData };
}

describe('firmware-tripwire: AVTransport LastChange round-trip', () => {
  const CURRENT_ART = `http://${HOST}:${PORT}/getaa?s=1&u=x-sonos-spotify%3aspotify%253atrack%253a2nj0bzqYZR7PXs0BoQTW3V%3fsid%3d9%26flags%3d8224%26sn%3d7`;
  const CURRENT_ART_PATH = '/getaa?s=1&u=x-sonos-spotify%3aspotify%253atrack%253a2nj0bzqYZR7PXs0BoQTW3V%3fsid%3d9%26flags%3d8224%26sn%3d7';
  const CURRENT_TRACK_URI = 'x-sonos-spotify:spotify:track:2nj0bzqYZR7PXs0BoQTW3V?sid=9&flags=8224&sn=7';

  const NEXT_ART = `http://${HOST}:${PORT}/getaa?s=1&u=x-sonos-spotify%3aspotify%253atrack%253a7aKme0bvekUFoMI0cHGIRk%3fsid%3d9%26flags%3d8224%26sn%3d7`;
  const NEXT_TRACK_URI = 'x-sonos-spotify:spotify:track:7aKme0bvekUFoMI0cHGIRk?sid=9&flags=8224&sn=7';

  describe('CurrentTrackMetaData', () => {
    const { Current } = parseLastChange();

    it('decodes Title exactly', () => {
      expect(Current.Title).to.equal('Survive');
    });

    it('decodes Artist exactly', () => {
      expect(Current.Artist).to.equal('Bass Modulators');
    });

    it('decodes Album exactly', () => {
      expect(Current.Album).to.equal('Survive (feat. Bram Boender)');
    });

    it('decodes UpnpClass exactly', () => {
      expect(Current.UpnpClass).to.equal('object.item.audioItem.musicTrack');
    });

    it('decodes the res TrackUri as a byte-exact string', () => {
      expect(typeof Current.TrackUri).to.equal('string');
      expect(Current.TrackUri).to.equal(CURRENT_TRACK_URI);
    });

    it('keeps AlbumArtUri a string, never number-coerced or NaN', () => {
      expect(typeof Current.AlbumArtUri).to.equal('string');
      expect(Number.isNaN(Current.AlbumArtUri as any)).to.equal(false);
      expect(Current.AlbumArtUri).to.not.equal(undefined);
    });

    it('preserves the AlbumArtUri byte-exact, with & and percent-encodings intact', () => {
      expect(Current.AlbumArtUri).to.equal(CURRENT_ART);
    });

    it('preserves the raw & and numeric-looking segments in the art query string', () => {
      const art = Current.AlbumArtUri as string;
      expect(art.endsWith(CURRENT_ART_PATH)).to.equal(true);
      expect(art).to.contain('&u=');
      expect(art).to.not.contain('&amp;');
      expect(art).to.contain('s=1');
      expect(art).to.contain('%3a');
      expect(art).to.contain('%253a');
      expect(art).to.contain('%26');
    });
  });

  describe('NextTrackMetaData', () => {
    const { Next } = parseLastChange();

    it('decodes Title exactly', () => {
      expect(Next.Title).to.equal('Fine Day');
    });

    it('decodes Artist exactly', () => {
      expect(Next.Artist).to.equal('Coone');
    });

    it('decodes the res TrackUri as a byte-exact string', () => {
      expect(typeof Next.TrackUri).to.equal('string');
      expect(Next.TrackUri).to.equal(NEXT_TRACK_URI);
    });

    it('keeps AlbumArtUri a byte-exact string, never number-coerced or NaN', () => {
      expect(typeof Next.AlbumArtUri).to.equal('string');
      expect(Number.isNaN(Next.AlbumArtUri as any)).to.equal(false);
      expect(Next.AlbumArtUri).to.equal(NEXT_ART);
      expect((Next.AlbumArtUri as string)).to.not.contain('&amp;');
    });
  });
});
