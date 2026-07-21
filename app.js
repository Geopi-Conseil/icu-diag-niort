// ---------- Carte de base ----------
const map = L.map("map", { zoomControl: true }).setView([46.323, -0.459], 13);
map.createPane("rasterPane"); map.getPane("rasterPane").style.zIndex = 350;
map.createPane("zonesPane"); map.getPane("zonesPane").style.zIndex = 370;
map.createPane("buildingsPane"); map.getPane("buildingsPane").style.zIndex = 400;
map.createPane("pointsPane"); map.getPane("pointsPane").style.zIndex = 450;

L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
  attribution: "Esri World Imagery", maxZoom: 19
}).addTo(map);

// ---------- État ----------
let zonesLayer = null;
let zonesData = null;
let percentiles = null;
let demoStats = { population: [0,1], pauvrete: [0,100], age: [0,100] };
let zoneFillMode = "indice";
let showPriorityHighlight = false;
let allEtablissements = { ecoles: [], ehpad: [], creches: [] };
let rasterLayers = { albedo: null, vegetation: null, lst: null };
let precise = { albedo: null, vegetation: null };
let buildingsLayer = null;
let buildingsEnabled = false;
let buildingsFetchTimer = null;
let searchMarker = null;
let boundaryLayer = null;

const HOT_STOPS = {
  albedo: [[0,[10,5,5]],[0.15,[90,10,10]],[0.35,[170,25,15]],[0.55,[225,90,15]],[0.75,[245,165,40]],[0.9,[255,225,90]],[1,[255,252,225]]],
};

function colorForFraction(t, ramp) {
  t = Math.max(0, Math.min(1, t));
  const stops = ramp || [[0,[44,123,182]],[0.35,[255,255,191]],[0.6,[253,174,97]],[0.85,[215,25,28]],[1,[92,0,0]]];
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0,c0] = stops[i], [t1,c1] = stops[i+1];
    if (t >= t0 && t <= t1) {
      const f = (t-t0)/(t1-t0);
      const rgb = c0.map((v,i2) => Math.round(v + f*(c1[i2]-v)));
      return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
    }
  }
  return `rgb(${stops[stops.length-1][1].join(",")})`;
}

// ---------- Chargement des données ----------
Promise.all([
  fetch("data/zones.geojson").then(r => r.json()),
  fetch("data/percentiles.json").then(r => r.json()),
  fetch("data/boundary.geojson").then(r => r.json()),
  fetch("data/ecoles.geojson").then(r => r.json()),
  fetch("data/ehpad.geojson").then(r => r.json()),
  fetch("data/creches.geojson").then(r => r.json()),
]).then(([zones, pct, boundary, ecoles, ehpad, creches]) => {
  zonesData = zones;
  percentiles = pct;
  allEtablissements = { ecoles: ecoles.features, ehpad: ehpad.features, creches: creches.features };

  boundaryLayer = L.geoJSON(boundary, { style: { color: "#33322c", weight: 1.5, fill: false } }).addTo(map);
  map.fitBounds(boundaryLayer.getBounds(), { padding: [10,10] });

  computeDemoStats();
  updateDemoLegendLabels();
  loadZones();
  refreshEtablissements();
});

function loadZones() {
  zonesLayer = L.geoJSON(zonesData, {
    pane: "zonesPane",
    style: styleZone,
    onEachFeature: (feat, layer) => {
      layer.on("click", () => analyseZone(feat));
    }
  }).addTo(map);
}

function computeDemoStats() {
  const pops = zonesData.features.map(f => f.properties.population_est).filter(v => v != null);
  const pauv = zonesData.features.map(f => f.properties.taux_pauvrete_est).filter(v => v != null);
  const age = zonesData.features.map(f => f.properties.pct_65plus_est).filter(v => v != null);
  demoStats.population = [Math.min(...pops), Math.max(...pops)];
  demoStats.pauvrete = [Math.min(...pauv), Math.max(...pauv)];
  demoStats.age = [Math.min(...age), Math.max(...age)];
}

function styleZone(feat) {
  const p = feat.properties;
  const isPrio = p.is_priority === 1;
  let fillColor = "#8a8878", fillOpacity = 0.06;

  if (zoneFillMode === "indice") {
    const t = percentileRank("indice_chaleur", p.indice_chaleur) / 100;
    fillColor = colorForFraction(t);
    fillOpacity = 0.6;
  } else if (["population", "pauvrete", "age"].includes(zoneFillMode)) {
    const field = { population: "population_est", pauvrete: "taux_pauvrete_est", age: "pct_65plus_est" }[zoneFillMode];
    const val = p[field];
    if (val != null) {
      const [mn, mx] = demoStats[zoneFillMode];
      const t = mx > mn ? (val - mn) / (mx - mn) : 0.5;
      fillColor = colorForFraction(t);
      fillOpacity = 0.65;
    } else {
      fillColor = "#8a8878"; fillOpacity = 0.04;
    }
  }

  if (showPriorityHighlight && isPrio) {
    return { fillColor, fillOpacity: Math.max(fillOpacity, 0.55), color: "#e0182f", weight: 1.8 };
  }
  return { fillColor, fillOpacity, color: "#ffffff40", weight: 0.3 };
}

function refreshZoneStyles() {
  if (!zonesLayer) return;
  updateZonesVisibility();
}

["mode-indice", "mode-population", "mode-pauvrete", "mode-age"].forEach(id => {
  document.getElementById(id).addEventListener("change", (e) => {
    if (e.target.checked) {
      const modeMap = { "mode-indice": "indice", "mode-population": "population", "mode-pauvrete": "pauvrete", "mode-age": "age" };
      zoneFillMode = modeMap[id];
      ["mode-indice", "mode-population", "mode-pauvrete", "mode-age"].filter(other => other !== id)
        .forEach(other => { document.getElementById(other).checked = false; });
    } else {
      zoneFillMode = null;
    }
    refreshZoneStyles();
  });
});
document.getElementById("mode-priority").addEventListener("change", (e) => {
  showPriorityHighlight = e.target.checked;
  refreshZoneStyles();
});

function percentileRank(kind, value) {
  const table = percentiles[kind];
  if (!table || value == null) return 50;
  if (value <= table[0]) return 0;
  if (value >= table[table.length-1]) return 100;
  for (let i = 0; i < table.length-1; i++) {
    if (value >= table[i] && value <= table[i+1]) {
      const f = (value - table[i]) / (table[i+1] - table[i] || 1);
      return i + f;
    }
  }
  return 50;
}

// ---------- Établissements ----------
function makeEtabIcon(type, isPrio) {
  const config = { ecole: ["#f5a623", "ti-school"], ehpad: ["#8a2be2", "ti-heart"], creche: ["#00b4b4", "ti-baby-carriage"] };
  const [bg, icon] = config[type];
  const size = isPrio ? 18 : 14;
  const border = isPrio ? "2px solid #e0182f" : "0.75px solid #222";
  return L.divIcon({
    className: "etab-icon",
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${bg};border:${border};display:flex;align-items:center;justify-content:center;box-shadow:0 1px 3px rgba(0,0,0,0.4);"><i class="ti ${icon}" style="color:#fff;font-size:${Math.max(size-6,8)}px;"></i></div>`,
    iconSize: [size, size], iconAnchor: [size/2, size/2],
  });
}

let etabLayers = { ecoles: null, ehpad: null, creches: null };

function refreshEtablissements() {
  const configs = [["ecoles", "ecole"], ["ehpad", "ehpad"], ["creches", "creche"]];
  const checked = document.getElementById("layer-etablissements").checked;
  for (const [key, type] of configs) {
    if (etabLayers[key]) map.removeLayer(etabLayers[key]);
    if (!checked) continue;
    etabLayers[key] = L.layerGroup(
      allEtablissements[key].map(f => {
        const [lon, lat] = f.geometry.coordinates;
        const isPrio = !!f.properties.zone_prioritaire_chaleur;
        const marker = L.marker([lat, lon], { icon: makeEtabIcon(type, isPrio), pane: "pointsPane" });
        marker.bindTooltip(f.properties.nom_norm || type, { direction: "top" });
        marker.on("click", () => analyseEtablissement(f, type));
        return marker;
      })
    ).addTo(map);
  }
}
document.getElementById("layer-etablissements").addEventListener("change", refreshEtablissements);

// ---------- Rasters (albédo, végétation, LST) ----------
function updateZonesVisibility() {
  const anyRasterOn = ["layer-albedo", "layer-vegetation", "layer-lst"].some(id => document.getElementById(id).checked);
  if (!zonesLayer) return;
  zonesLayer.eachLayer(l => {
    const base = styleZone(l.feature);
    if (anyRasterOn) {
      l.setStyle({ ...base, fillOpacity: base.fillOpacity * 0.2, opacity: 0.3 });
    } else {
      l.setStyle(base);
    }
  });
}

function toggleRaster(kind, checkboxId) {
  document.getElementById(checkboxId).addEventListener("change", (e) => {
    if (e.target.checked) {
      fetch(`data/niort_${kind}.json`).then(r => r.json()).then(meta => {
        rasterLayers[kind] = L.imageOverlay(`data/niort_${kind}.png`, meta.bounds, { opacity: 0.85, pane: "rasterPane" }).addTo(map);
      });
      if (kind === "albedo" || kind === "vegetation") {
        GeoTIFF.fromUrl(`data/niort_${kind}_precise.tif`)
          .then(t => t.getImage())
          .then(img => img.readRasters().then(r => ({ data: r[0], width: img.getWidth(), height: img.getHeight() })))
          .then(({ data, width, height }) => {
            fetch(`data/niort_${kind}.json`).then(r => r.json()).then(meta => {
              precise[kind] = { data, width, height, bounds: meta.bounds };
            });
          });
      }
    } else {
      if (rasterLayers[kind]) { map.removeLayer(rasterLayers[kind]); rasterLayers[kind] = null; }
      if (kind === "albedo" || kind === "vegetation") precise[kind] = null;
    }
    updateZonesVisibility();
  });
}
toggleRaster("albedo", "layer-albedo");
toggleRaster("vegetation", "layer-vegetation");
toggleRaster("lst", "layer-lst");

function sampleRaster(kind, lat, lon, scale) {
  const p = precise[kind];
  if (!p) return null;
  const [[south, west], [north, east]] = p.bounds;
  if (lat < south || lat > north || lon < west || lon > east) return null;
  const px = Math.floor(((lon - west) / (east - west)) * p.width);
  const py = Math.floor(((north - lat) / (north - south)) * p.height);
  if (px < 0 || px >= p.width || py < 0 || py >= p.height) return null;
  const raw = p.data[py * p.width + px];
  if (raw === 0) return null;
  return raw / scale;
}

function sampleVegetationBuffer(lat, lon, radiusMeters) {
  const p = precise.vegetation;
  if (!p) return null;
  const [[south, west], [north, east]] = p.bounds;
  const degLat = 1/111320, degLon = 1/(111320*Math.cos(lat*Math.PI/180));
  const rLat = radiusMeters*degLat, rLon = radiusMeters*degLon;
  let nIn = 0, nVeg = 0;
  for (let dLat=-rLat; dLat<=rLat; dLat+=Math.max(rLat/20,1e-6)) {
    for (let dLon=-rLon; dLon<=rLon; dLon+=Math.max(rLon/20,1e-6)) {
      const dist = Math.sqrt((dLat/degLat)**2 + (dLon/degLon)**2);
      if (dist > radiusMeters) continue;
      const plat = lat+dLat, plon = lon+dLon;
      if (plat<south||plat>north||plon<west||plon>east) continue;
      const px = Math.floor(((plon-west)/(east-west))*p.width);
      const py = Math.floor(((north-plat)/(north-south))*p.height);
      if (px<0||px>=p.width||py<0||py>=p.height) continue;
      nIn++;
      if (p.data[py*p.width+px] !== 0) nVeg++;
    }
  }
  if (nIn === 0) return null;
  return 100*nVeg/nIn;
}

// ---------- Bâtiments (WFS IGN dynamique) ----------
function findZoneAt(lat, lon) {
  if (!zonesData) return null;
  const pt = [lon, lat];
  for (const f of zonesData.features) {
    if (pointInFeature(pt, f.geometry)) return f;
  }
  return null;
}
function pointInFeature(pt, geom) {
  if (geom.type === "Polygon") return pointInPolygon(pt, geom.coordinates);
  if (geom.type === "MultiPolygon") return geom.coordinates.some(c => pointInPolygon(pt, c));
  return false;
}
function pointInPolygon(pt, rings) {
  const ring = rings[0];
  let inside = false;
  for (let i=0, j=ring.length-1; i<ring.length; j=i++) {
    const xi=ring[i][0], yi=ring[i][1], xj=ring[j][0], yj=ring[j][1];
    const intersect = ((yi>pt[1]) !== (yj>pt[1])) && (pt[0] < (xj-xi)*(pt[1]-yi)/(yj-yi)+xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function styleBuilding(feat) {
  const center = polygonCenter(feat.geometry.coordinates);
  const albedo = sampleRaster("albedo", center.lat, center.lon, 10000);
  feat.properties._albedo = albedo;
  feat.properties._center = center;
  return {
    fillColor: albedo != null ? colorForFraction((albedo-0.15)/(0.40-0.15), HOT_STOPS.albedo) : "#cccccc",
    fillOpacity: albedo != null ? 0.9 : 0.15,
    color: "#ffffffaa", weight: 0.6,
  };
}
function polygonCenter(coords) {
  const ring = Array.isArray(coords[0][0][0]) ? coords[0][0] : coords[0];
  let sx=0, sy=0;
  ring.forEach(([x,y]) => { sx+=x; sy+=y; });
  return { lon: sx/ring.length, lat: sy/ring.length };
}

let selectedBuildingLayer = null;

function loadBuildingsInView() {
  if (!buildingsEnabled) return;
  if (map.getZoom() < 16) {
    if (buildingsLayer) { map.removeLayer(buildingsLayer); buildingsLayer = null; }
    document.getElementById("buildings-hint").style.display = "block";
    return;
  }
  document.getElementById("buildings-hint").style.display = "none";
  const b = map.getBounds();
  const bbox = `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()},EPSG:4326`;
  const url = `https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAME=BDTOPO_V3:batiment&SRSNAME=EPSG:4326&BBOX=${bbox}&outputFormat=application/json&COUNT=1500`;
  fetch(url).then(r => r.json()).then(gj => {
    if (buildingsLayer) map.removeLayer(buildingsLayer);
    selectedBuildingLayer = null;
    buildingsLayer = L.geoJSON(gj, {
      pane: "buildingsPane", style: styleBuilding,
      onEachFeature: (feat, layer) => {
        layer.on("click", () => {
          if (selectedBuildingLayer && selectedBuildingLayer !== layer) {
            selectedBuildingLayer.setStyle(styleBuilding(selectedBuildingLayer.feature));
          }
          layer.setStyle({ color: "#ffe15a", weight: 3, fillOpacity: 0.95 });
          layer.bringToFront();
          selectedBuildingLayer = layer;
          analyseBuilding(feat);
        });
      }
    }).addTo(map);
  }).catch(() => {});
}
document.getElementById("layer-buildings").addEventListener("change", (e) => {
  buildingsEnabled = e.target.checked;
  if (buildingsEnabled) loadBuildingsInView();
  else if (buildingsLayer) { map.removeLayer(buildingsLayer); buildingsLayer = null; document.getElementById("buildings-hint").style.display = "none"; }
});
map.on("moveend", () => { clearTimeout(buildingsFetchTimer); buildingsFetchTimer = setTimeout(loadBuildingsInView, 400); });

// ---------- Recherche d'adresse ----------
const input = document.getElementById("address-input");
const suggestions = document.getElementById("address-suggestions");
let debounceTimer = null;
input.addEventListener("input", () => {
  clearTimeout(debounceTimer);
  const q = input.value.trim();
  if (q.length < 4) { suggestions.style.display = "none"; return; }
  debounceTimer = setTimeout(() => fetchSuggestions(q), 300);
});
function fetchSuggestions(q) {
  fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(q)}&citycode=79191&limit=5`)
    .then(r => r.json()).then(d => {
      suggestions.innerHTML = "";
      (d.features || []).forEach(f => {
        const div = document.createElement("div");
        div.textContent = f.properties.label;
        div.addEventListener("click", () => {
          input.value = f.properties.label;
          suggestions.style.display = "none";
          analyseAddress(f.properties.label, f.geometry.coordinates[1], f.geometry.coordinates[0]);
        });
        suggestions.appendChild(div);
      });
      suggestions.style.display = d.features && d.features.length ? "block" : "none";
    }).catch(() => { suggestions.style.display = "none"; });
}
document.getElementById("search-btn").addEventListener("click", () => {
  const q = input.value.trim();
  if (!q) return;
  fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(q)}&citycode=79191&limit=1`)
    .then(r => r.json()).then(d => {
      if (d.features && d.features.length) {
        const f = d.features[0];
        analyseAddress(f.properties.label, f.geometry.coordinates[1], f.geometry.coordinates[0]);
      }
    });
});

// ---------- Solutions clés en main ----------
function buildSolutions(props, nearbyEhpad, nearbyEcole) {
  const solutions = [];
  const bur = props.bur || 0, ver = props.ver || 0, lcz = props.lcz_int, alb = props.alb_mean;
  const lowVeg = ver < 15;
  const denseBuiltLowRise = [6,8,9].includes(lcz);
  const darkSurface = alb != null && alb < 0.25;

  let needsAmenagement = false;

  if (nearbyEcole) {
    solutions.push({
      tag: "amenagement", tagLabel: "Aménagement", icon: "ti-school",
      title: "Arbres et végétaux dans la cour d'école",
      text: "Une école primaire est à proximité : ombrage et rafraîchissement par évapotranspiration, un des leviers les plus rapides et les moins coûteux.",
      impact: "-4°C", delai: "0 à 1 mois", cout: "30 à 60 euros HT/m2",
      link: "https://plusfraichemaville.fr/fiche-solution/arbres-vegetaux-cour-ecole",
      linkLabel: "Fiche solution, ADEME",
    });
    needsAmenagement = true;
  }
  if (lowVeg) {
    solutions.push({
      tag: "amenagement", tagLabel: "Aménagement", icon: "ti-plant-2",
      title: "Planter un arbre",
      text: "Faible couvert végétal mesuré sur cet îlot : ombrage et rafraîchissement par évapotranspiration, délai de mise en oeuvre court.",
      impact: "-4°C", delai: "0 à 1 mois", cout: "25 à 1000 euros HT/m2",
      link: "https://plusfraichemaville.fr/fiche-solution/planter-un-arbre",
      linkLabel: "Fiche solution, ADEME",
    });
    needsAmenagement = true;
  }
  if (bur > 40) {
    solutions.push({
      tag: "amenagement", tagLabel: "Aménagement", icon: "ti-droplet",
      title: "Revêtement drainant / perméable",
      text: "Taux de surface bâtie élevé, peu de sol perméable : infiltre les eaux pluviales et réduit l'effet d'îlot de chaleur.",
      impact: "-2.1°C", delai: "1 à 2 mois", cout: "5 à 150 euros HT/m2",
      link: "https://plusfraichemaville.fr/fiche-solution/revetement-drainant",
      linkLabel: "Fiche solution, ADEME",
    });
    needsAmenagement = true;
  }
  if (darkSurface) {
    solutions.push({
      tag: "amenagement", tagLabel: "Aménagement", icon: "ti-brightness-up",
      title: "Revêtement à albédo élevé",
      text: `Albédo mesuré de ${alb.toFixed(2)}, parmi les plus sombres de la commune : peinture ou revêtement réfléchissant pour toitures et chaussées.`,
      impact: "-3°C", delai: "1 à 3 mois", cout: "20 à 35 euros HT/m2",
      link: "https://plusfraichemaville.fr/fiche-solution/revetement-albedo-eleve",
      linkLabel: "Fiche solution, ADEME",
    });
    needsAmenagement = true;
  }
  if (denseBuiltLowRise && lowVeg) {
    solutions.push({
      tag: "amenagement", tagLabel: "Aménagement", icon: "ti-sun-off",
      title: "Structure d'ombrage",
      text: "Bâti bas, peu d'arbres à proximité : voiles ou structures d'ombrage sur rue ou espace public. Impact plus modeste que la végétalisation, à considérer en complément.",
      impact: "-0.2°C", delai: "0 à 3 mois", cout: "500 à 1000 euros HT/m2",
      link: "https://plusfraichemaville.fr/fiche-solution/structure-ombrage",
      linkLabel: "Fiche solution, ADEME",
    });
  }
  if ((props.pct_65plus_est != null && props.pct_65plus_est > 20) || nearbyEhpad) {
    solutions.push({
      tag: "social", tagLabel: "Accompagnement social", icon: "ti-heart-handshake",
      title: "Registre communal des personnes vulnérables",
      text: "Part de personnes âgées élevée à proximité : obligation légale du maire, permet un contact prioritaire en cas d'alerte canicule.",
      link: "https://www.service-public.gouv.fr/demarches-silence-vaut-accord/demarches/1635",
      linkLabel: "Démarche officielle, Service-Public.fr",
    });
  }
  if (nearbyEhpad) {
    solutions.push({
      tag: "social", tagLabel: "Accompagnement social", icon: "ti-building-hospital",
      title: "Pièce rafraîchie en EHPAD",
      text: "Un EHPAD à proximité : chaque établissement doit légalement disposer d'un local rafraîchi accessible aux résidents en cas de forte chaleur.",
      link: "https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000032610131",
      linkLabel: "Article D312-161, Légifrance",
    });
  }
  if (needsAmenagement) {
    solutions.push({
      tag: "financement", tagLabel: "Financement", icon: "ti-coin",
      title: "Fonds vert, mesure renaturation",
      text: "Finance à la fois les diagnostics d'îlots de chaleur et les travaux de végétalisation, désimperméabilisation ou revêtements réfléchissants.",
      link: "https://aides-territoires.beta.gouv.fr/aides/a086-financer-des-solutions-dadaptation-au-changem/",
      linkLabel: "Fiche aide, Aides-territoires",
    });
  }
  return solutions;
}

// ---------- Rendu du panneau diagnostic ----------
function renderDiagnostic({ label, badgeType, zoneProps, albedo, veg100, nearbyEhpad, nearbyEcole }) {
  document.getElementById("diag-empty").style.display = "none";
  document.getElementById("diag-content").style.display = "block";
  document.getElementById("diag-address").textContent = label;

  const badge = document.getElementById("diag-badge");
  const badgeMap = { zone: "Îlot", ecole: "École primaire", ehpad: "EHPAD", creche: "Crèche", address: "Adresse recherchée", batiment: "Bâtiment" };
  badge.textContent = badgeMap[badgeType] || "";
  badge.className = "badge " + badgeType;

  const indice = zoneProps ? zoneProps.indice_chaleur : null;
  const albVal = albedo != null ? albedo : (zoneProps ? zoneProps.alb_mean : null);
  const INDICE_RANGE = [0.18, 0.80];
  const ALBEDO_RANGE = [0.15, 0.40];

  function fillBar(fillId, value, range, ramp) {
    const frac = Math.max(0, Math.min(1, (value - range[0]) / (range[1] - range[0])));
    document.getElementById(fillId).style.width = (frac * 100) + "%";
    document.getElementById(fillId).style.background = colorForFraction(frac, ramp);
  }

  if (indice != null) {
    const pct = percentileRank("indice_chaleur", indice);
    document.getElementById("diag-indice").textContent = indice.toFixed(2);
    fillBar("diag-indice-fill", indice, INDICE_RANGE);
    document.getElementById("diag-indice-context").textContent = `Plus élevé que ${Math.round(pct)}% des îlots de Niort`;
  } else {
    document.getElementById("diag-indice").textContent = "-";
    document.getElementById("diag-indice-fill").style.width = "0%";
    document.getElementById("diag-indice-context").textContent = "Non disponible à cet endroit";
  }

  if (albVal != null) {
    const pctA = percentileRank("albedo", albVal);
    document.getElementById("diag-albedo").textContent = albVal.toFixed(2);
    fillBar("diag-albedo-fill", albVal, ALBEDO_RANGE, HOT_STOPS.albedo);
    document.getElementById("diag-albedo-context").textContent = `Plus sombre que ${Math.round(100 - pctA)}% des surfaces`;
  } else {
    document.getElementById("diag-albedo").textContent = "-";
    document.getElementById("diag-albedo-fill").style.width = "0%";
    document.getElementById("diag-albedo-context").textContent = "Non disponible à cet endroit";
  }

  const hasDemo = zoneProps && zoneProps.is_priority === 1 && zoneProps.population_est != null;
  document.getElementById("context-pop").style.display = hasDemo ? "flex" : "none";
  document.getElementById("card-pauvrete").style.display = hasDemo ? "block" : "none";
  document.getElementById("card-age").style.display = hasDemo ? "block" : "none";
  document.getElementById("diag-no-demo").style.display = (zoneProps && !hasDemo) ? "block" : "none";

  if (hasDemo) {
    document.getElementById("diag-population").textContent = `~ ${Math.round(zoneProps.population_est)} habitants`;
    const pauvrete = zoneProps.taux_pauvrete_est;
    document.getElementById("diag-pauvrete").textContent = pauvrete != null ? pauvrete.toFixed(0) + "%" : "-";
    if (pauvrete != null) fillBar("diag-pauvrete-fill", pauvrete, demoStats.pauvrete);
    else document.getElementById("diag-pauvrete-fill").style.width = "0%";
    document.getElementById("scale-pauvrete").innerHTML = `<span>${demoStats.pauvrete[0].toFixed(0)}%</span><span>${demoStats.pauvrete[1].toFixed(0)}%</span>`;
    document.getElementById("diag-pauvrete-context").textContent = pauvrete != null ? "Contre 8.9% en moyenne hors zones prioritaires" : "";

    const age = zoneProps.pct_65plus_est;
    document.getElementById("diag-age").textContent = age != null ? `${Math.round(zoneProps.pop_65plus_est)} pers.` : "-";
    if (age != null) fillBar("diag-age-fill", age, demoStats.age);
    else document.getElementById("diag-age-fill").style.width = "0%";
    document.getElementById("scale-age").innerHTML = `<span>${demoStats.age[0].toFixed(0)}%</span><span>${demoStats.age[1].toFixed(0)}%</span>`;
    document.getElementById("diag-age-context").textContent = age != null ? `Soit ${age.toFixed(0)}% de la population de l'îlot` : "";
  }

  const vegRow = document.getElementById("context-veg");
  if (veg100 != null) {
    vegRow.style.display = "flex";
    document.getElementById("diag-veg100").textContent = Math.round(veg100) + "% de couvert végétal";
  } else {
    vegRow.style.display = "none";
  }

  const solutionsSection = document.getElementById("solutions-section");
  const solutionsList = document.getElementById("solutions-list");
  if (zoneProps) {
    const solutions = buildSolutions(zoneProps, nearbyEhpad, nearbyEcole);
    if (solutions.length) {
      solutionsSection.style.display = "block";
      solutionsList.innerHTML = solutions.map(s => `
        <div class="solution-card">
          <span class="solution-tag ${s.tag}">${s.tagLabel}</span>
          <p class="solution-title"><i class="ti ${s.icon}"></i> ${s.title}</p>
          <p class="solution-text">${s.text}</p>
          ${s.impact ? `<div class="solution-stats">
            <span><i class="ti ti-temperature-minus"></i> ${s.impact}</span>
            <span><i class="ti ti-clock"></i> ${s.delai}</span>
            <span><i class="ti ti-cash"></i> ${s.cout}</span>
          </div>` : ""}
          <a class="solution-link" href="${s.link}" target="_blank" rel="noopener">${s.linkLabel} <i class="ti ti-external-link"></i></a>
        </div>
      `).join("");
    } else {
      solutionsSection.style.display = "none";
    }
  } else {
    solutionsSection.style.display = "none";
  }
}

function isNearEhpad(lat, lon, radiusMeters) {
  return allEtablissements.ehpad.some(f => {
    const [elon, elat] = f.geometry.coordinates;
    const d = haversine(lat, lon, elat, elon);
    return d < radiusMeters;
  });
}
function isNearEcole(lat, lon, radiusMeters) {
  return allEtablissements.ecoles.some(f => {
    const [elon, elat] = f.geometry.coordinates;
    const d = haversine(lat, lon, elat, elon);
    return d < radiusMeters;
  });
}
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2-lat1)*Math.PI/180, dLon = (lon2-lon1)*Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R*2*Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function analyseZone(feature) {
  const p = feature.properties;
  const center = polygonCenter(feature.geometry.coordinates);
  if (searchMarker) map.removeLayer(searchMarker);
  searchMarker = L.marker([center.lat, center.lon]).addTo(map);
  const veg100 = sampleVegetationBuffer(center.lat, center.lon, 100);
  renderDiagnostic({
    label: `Îlot LCZ ${p.lcz_int}`,
    badgeType: "zone", zoneProps: p, albedo: null, veg100,
    nearbyEhpad: isNearEhpad(center.lat, center.lon, 300),
    nearbyEcole: isNearEcole(center.lat, center.lon, 300),
  });
}

function analyseEtablissement(feature, type) {
  const [lon, lat] = feature.geometry.coordinates;
  if (searchMarker) map.removeLayer(searchMarker);
  searchMarker = L.marker([lat, lon]).addTo(map);
  map.setView([lat, lon], Math.max(map.getZoom(), 15));
  const zone = findZoneAt(lat, lon);
  const veg100 = sampleVegetationBuffer(lat, lon, 100);
  renderDiagnostic({
    label: feature.properties.nom_norm || type,
    badgeType: type, zoneProps: zone ? zone.properties : null, albedo: null, veg100,
    nearbyEhpad: type === "ehpad" ? true : isNearEhpad(lat, lon, 300),
    nearbyEcole: type === "ecole" ? true : isNearEcole(lat, lon, 300),
  });
}

function analyseBuilding(feature) {
  const center = feature.properties._center;
  if (searchMarker) map.removeLayer(searchMarker);
  searchMarker = L.marker([center.lat, center.lon]).addTo(map);
  const zone = findZoneAt(center.lat, center.lon);
  const veg100 = sampleVegetationBuffer(center.lat, center.lon, 100);
  const usage = feature.properties.usage_1 || feature.properties.nature || "Batiment";
  renderDiagnostic({
    label: usage, badgeType: "batiment", zoneProps: zone ? zone.properties : null,
    albedo: feature.properties._albedo, veg100,
    nearbyEhpad: isNearEhpad(center.lat, center.lon, 300),
    nearbyEcole: isNearEcole(center.lat, center.lon, 300),
  });
}

function analyseAddress(label, lat, lon) {
  if (searchMarker) map.removeLayer(searchMarker);
  searchMarker = L.marker([lat, lon]).addTo(map);
  map.setView([lat, lon], 16);
  const zone = findZoneAt(lat, lon);
  const albedo = sampleRaster("albedo", lat, lon, 10000);
  const veg100 = sampleVegetationBuffer(lat, lon, 100);
  renderDiagnostic({
    label, badgeType: "address", zoneProps: zone ? zone.properties : null, albedo, veg100,
    nearbyEhpad: isNearEhpad(lat, lon, 300),
    nearbyEcole: isNearEcole(lat, lon, 300),
  });
}

// ---------- Légendes dépliables : chaque case à cocher révèle sa légende ----------
const LEGEND_MAP = {
  "mode-indice": "legend-indice",
  "mode-priority": "legend-priority",
  "layer-albedo": "legend-albedo",
  "layer-lst": "legend-lst",
  "layer-vegetation": "legend-vegetation",
  "layer-buildings": "legend-buildings",
  "mode-population": "legend-population",
  "mode-pauvrete": "legend-pauvrete",
  "mode-age": "legend-age",
  "layer-etablissements": "legend-etablissements",
};
Object.entries(LEGEND_MAP).forEach(([checkboxId, legendId]) => {
  const checkbox = document.getElementById(checkboxId);
  const legend = document.getElementById(legendId);
  checkbox.addEventListener("change", () => {
    legend.classList.toggle("open", checkbox.checked);
  });
});

// ---------- Valeurs dynamiques des légendes socio-démographiques ----------
function updateDemoLegendLabels() {
  document.getElementById("labels-population").innerHTML =
    `<span>${Math.round(demoStats.population[0])} hab.</span><span>${Math.round(demoStats.population[1])} hab.</span>`;
  document.getElementById("labels-pauvrete").innerHTML =
    `<span>${demoStats.pauvrete[0].toFixed(0)}%</span><span>${demoStats.pauvrete[1].toFixed(0)}%</span>`;
  document.getElementById("labels-age").innerHTML =
    `<span>${demoStats.age[0].toFixed(0)}%</span><span>${demoStats.age[1].toFixed(0)}%</span>`;
}
