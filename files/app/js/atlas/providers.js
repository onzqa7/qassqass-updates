/* Map tile providers (shared by the renderer and the Electron main process). Web-Mercator XYZ tiles. */
(function (root) {
  const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/';
  const P = {
    esri_img: { ar: 'قمر صناعي عالي الدقة', en: 'Satellite (Esri World Imagery)', url: ESRI + 'World_Imagery/MapServer/tile/{z}/{y}/{x}', max: 19, kind: 'img', bundle: 'sat', attrib: 'Esri, Maxar, Earthstar Geographics' },
    s2: { ar: 'قمر صناعي بلا غيوم (Sentinel-2)', en: 'Sentinel-2 cloudless', url: 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg', max: 15, kind: 'img', bundle: 'sat', attrib: 'Sentinel-2 cloudless – EOX IT Services (contains modified Copernicus Sentinel data)' },
    esri_natgeo: { ar: 'ناشيونال جيوغرافيك', en: 'National Geographic', url: ESRI + 'NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}', max: 16, kind: 'map', bundle: 'relief', attrib: 'Esri, National Geographic' },
    esri_physical: { ar: 'خريطة طبيعية', en: 'Physical', url: ESRI + 'World_Physical_Map/MapServer/tile/{z}/{y}/{x}', max: 8, kind: 'map', bundle: 'relief', attrib: 'Esri, US NPS' },
    esri_relief: { ar: 'تضاريس مظللة', en: 'Shaded relief', url: ESRI + 'World_Shaded_Relief/MapServer/tile/{z}/{y}/{x}', max: 13, kind: 'map', bundle: 'relief', attrib: 'Esri' },
    esri_topo: { ar: 'طبوغرافية', en: 'Topographic', url: ESRI + 'World_Topo_Map/MapServer/tile/{z}/{y}/{x}', max: 19, kind: 'map', attrib: 'Esri' },
    esri_street: { ar: 'شوارع', en: 'Streets', url: ESRI + 'World_Street_Map/MapServer/tile/{z}/{y}/{x}', max: 19, kind: 'map', attrib: 'Esri' },
    esri_ocean: { ar: 'محيطات وأعماق', en: 'Ocean', url: ESRI + 'Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}', max: 13, kind: 'map', bundle: 'relief', attrib: 'Esri, GEBCO, NOAA' },
    esri_dark: { ar: 'رمادي داكن', en: 'Dark gray canvas', url: ESRI + 'Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', max: 16, kind: 'map', attrib: 'Esri' },
    esri_light: { ar: 'رمادي فاتح', en: 'Light gray canvas', url: ESRI + 'Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', max: 16, kind: 'map', attrib: 'Esri' },
    carto_dark: { ar: 'داكن (CARTO)', en: 'CARTO dark', url: 'https://a.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}@2x.png', max: 19, kind: 'map', size: 512, attrib: '© OpenStreetMap contributors © CARTO' },
    carto_light: { ar: 'فاتح (CARTO)', en: 'CARTO light', url: 'https://a.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}@2x.png', max: 19, kind: 'map', size: 512, attrib: '© OpenStreetMap contributors © CARTO' },
    carto_voyager: { ar: 'ملوّنة (Voyager)', en: 'CARTO Voyager', url: 'https://a.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}@2x.png', max: 19, kind: 'map', size: 512, attrib: '© OpenStreetMap contributors © CARTO' },
    otm: { ar: 'طبوغرافية مفتوحة', en: 'OpenTopoMap', url: 'https://a.tile.opentopomap.org/{z}/{x}/{y}.png', max: 17, kind: 'map', attrib: '© OpenStreetMap contributors, SRTM | © OpenTopoMap (CC-BY-SA)' },
    night: { ar: 'أضواء الليل (ناسا)', en: 'NASA Black Marble', url: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png', max: 8, kind: 'img', bundle: 'night', attrib: 'NASA Earth Observatory / GIBS' },
    hillshade: { ar: 'ظل التضاريس', en: 'Hillshade', url: ESRI + 'Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}', max: 16, kind: 'overlay', attrib: 'Esri, USGS' },
    labels: { ar: 'أسماء وحدود (إنجليزي)', en: 'Esri reference labels', url: ESRI + 'Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', max: 19, kind: 'overlay', attrib: 'Esri' },
    terrain: { ar: 'ارتفاعات التضاريس', en: 'Terrain elevation (AWS Terrarium)', url: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png', max: 15, kind: 'dem', attrib: 'Terrain: Mapzen/AWS Terrain Tiles (SRTM, GMTED, ETOPO1)' },
    sat_offline: { ar: 'قمر صناعي (بدون إنترنت)', en: 'Offline satellite', url: '', max: 4, kind: 'img', bundle: 'sat', attrib: 'NASA Blue Marble' },
  };
  const API = { P, BUNDLE_MAX: { sat: 4, night: 3, relief: 3 } };
  API.url = (id, z, x, y) => { const p = P[id]; return p && p.url ? p.url.replace('{z}', z).replace('{x}', x).replace('{y}', y) : ''; };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else { root.GW = root.GW || {}; root.GW.Atlas = root.GW.Atlas || {}; root.GW.Atlas.Providers = API; }
})(typeof window !== 'undefined' ? window : globalThis);
