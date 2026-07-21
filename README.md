# ICU DIAG Niort

Webmap interactive de diagnostic de vulnérabilité thermique pour la commune de Niort. Identifie les
secteurs urbains cumulant le plus de facteurs de surchauffe (morphologie urbaine, albédo, température
de surface, faible végétalisation), les croise avec des indicateurs de vulnérabilité sociale et
démographique, et propose des solutions clés en main sourcées ADEME et Cerema, adaptées au profil de
chaque secteur.

Site 100% statique, aucun serveur ni base de données. Déployable gratuitement sur GitHub Pages.

## Fonctionnalités

- **1721 îlots** (zones climatiques locales, Cerema), colorés selon un indice de chaleur cumulative
  combinant morphologie urbaine, albédo et température de surface mesurée
- **429 îlots du dernier quartile** mis en évidence, avec population, taux de pauvreté et part des
  65 ans et plus estimés par pondération surfacique sur le carroyage INSEE
- **Recherche d'adresse**, clic sur un îlot, un bâtiment (chargement dynamique via le WFS IGN) ou un
  établissement (école primaire, EHPAD, crèche) : même panneau de diagnostic pour tous
- **Couches basculables** : albédo, couvert végétal, température de surface (composite estival)
- **Contexte de voisinage** : part de couvert végétal dans un rayon de 100 m autour du point analysé,
  calculée côté navigateur
- **Solutions clés en main**, générées selon le profil réel de l'îlot (morphologie, végétation, âge de
  la population), réparties en trois familles : aménagement, accompagnement social, financement

## Déployer sur GitHub Pages

```bash
git init
git add .
git commit -m "Premier import"
git branch -M main
git remote add origin https://github.com/<compte>/<depot>.git
git push -u origin main
```

Puis dans le dépôt GitHub : Settings, Pages, Source : branche main, dossier / (root).

## Méthodologie

Le détail complet de la méthode (sources, formules, tests de robustesse, limites) est disponible dans
le document `methodologie.docx` à la racine de ce dépôt.

Résumé :

- **LCZ** : Cerema, cartographie nationale 2022 (imagerie SPOT, BD TOPO IGN, référentiel Stewart et
  Oke adapté)
- **Albédo** : Sentinel-2 L2A, scène du 18 juin 2025 choisie pour sa proximité au solstice d'été
  (élévation solaire maximale, ombres minimales) et son absence de nuages, formule de Bonafoni et
  Sekertekin (2020), affinage de résolution par segmentation SLIC guidée par la BD ORTHO
- **Température de surface** : composite de 21 scènes Landsat 8/9 (été 2021-2025), masquées des nuages
- **Couvert végétal** : Meta AI Research / World Resources Institute, Canopy Height Maps v2
- **Indice composite** : normalisation min-max, pondération égale entre les trois composantes,
  robustesse testée contre deux pondérations alternatives (corrélation de rang 0,93 à 0,98)
- **Données socio-démographiques** : INSEE, carroyage Filosofi 2021 (200 m), agrégées par îlot par
  pondération surfacique

## Limite importante à garder en tête

L'indice de chaleur mesure un état diurne structurel, pas la capacité d'un secteur à évacuer la
chaleur la nuit, identifiée par la littérature comme le facteur le plus déterminant pour le risque
sanitaire réel. Les données démographiques par îlot sont des estimations par interpolation, pas un
recensement direct.

## Structure du dépôt

```
index.html            page principale
app.js                  logique carte, recherche, diagnostic, solutions
style.css                mise en forme
data/
  zones.geojson           1721 ilots LCZ avec tous les indicateurs
  percentiles.json         distribution de l'indice de chaleur et de l'albedo, pour le contexte
  boundary.geojson         contour communal
  ecoles.geojson, ehpad.geojson, creches.geojson   etablissements sensibles
  niort_{albedo,vegetation,lst}.png                images d'affichage
  niort_{albedo,vegetation}_precise.tif            rasters compacts pour lecture exacte au clic
scripts/
  convert_raster.py       conversion d'un GeoTIFF en PNG web (rasterio, Pillow)
```

*(noms de fichiers et de dossiers volontairement sans accent, par convention technique)*

## Sources de données

Toutes les sources sont en licence ouverte (Etalab, ODbL ou CC BY) :

- LCZ : Cerema
- Sentinel-2 L2A : Microsoft Planetary Computer
- BD ORTHO : IGN, Géoplateforme
- Landsat 8/9 : Microsoft Planetary Computer (USGS Collection 2)
- Canopy Height Maps v2 : Meta AI Research / World Resources Institute
- Bâtiments : IGN, Géoplateforme, WFS BDTOPO_V3
- EHPAD : FINESS, via AtlaSanté (DREES)
- Écoles primaires : Ministère de l'Éducation nationale
- Crèches : portail open data de la ville de Niort
- Revenus et population : INSEE, Filosofi et Recensement de la population
- Géocodage d'adresse : API Adresse, Base Adresse Nationale
