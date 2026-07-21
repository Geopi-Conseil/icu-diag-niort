# ICU DIAG Niort

Webmap interactive de diagnostic de vulnerabilite thermique pour la commune de Niort. Identifie les
secteurs urbains cumulant le plus de facteurs de surchauffe (morphologie urbaine, albedo, temperature
de surface, faible vegetalisation), les croise avec des indicateurs de vulnerabilite sociale et
demographique, et propose des solutions cles en main sourcees ADEME et Cerema, adaptees au profil de
chaque secteur.

Site 100% statique, aucun serveur ni base de donnees. Deployable gratuitement sur GitHub Pages.

## Fonctionnalites

- **1721 ilots** (zones climatiques locales, Cerema), colores selon un indice de chaleur cumulative
  combinant morphologie urbaine, albedo et temperature de surface mesuree
- **429 ilots du dernier quartile** mis en evidence, avec population, taux de pauvrete et part des
  65 ans et plus estimes par ponderation surfacique sur le carroyage INSEE
- **Recherche d'adresse**, clic sur un ilot, un batiment (chargement dynamique via le WFS IGN) ou un
  etablissement (ecole primaire, EHPAD, creche) : meme panneau de diagnostic pour tous
- **Couches basculables** : albedo, couvert vegetal, temperature de surface (composite estival)
- **Contexte de voisinage** : part de couvert vegetal dans un rayon de 100 m autour du point analyse,
  calculee cote navigateur
- **Solutions cles en main**, generees selon le profil reel de l'ilot (morphologie, vegetation, age de
  la population), reparties en trois familles : amenagement, accompagnement social, financement

## Deployer sur GitHub Pages

```bash
git init
git add .
git commit -m "Premier import"
git branch -M main
git remote add origin https://github.com/<compte>/<depot>.git
git push -u origin main
```

Puis dans le depot GitHub : Settings, Pages, Source : branche main, dossier / (root).

## Methodologie

Le detail complet de la methode (sources, formules, tests de robustesse, limites) est disponible dans
le document `methodologie.docx` a la racine de ce depot.

Resume :

- **LCZ** : Cerema, cartographie nationale 2022 (imagerie SPOT, BD TOPO IGN, referentiel Stewart et
  Oke adapte)
- **Albedo** : Sentinel-2 L2A, scene du 18 juin 2025 choisie pour sa proximite au solstice d'ete
  (elevation solaire maximale, ombres minimales) et son absence de nuages, formule de Bonafoni et
  Sekertekin (2020), affinage de resolution par segmentation SLIC guidee par la BD ORTHO
- **Temperature de surface** : composite de 21 scenes Landsat 8/9 (ete 2021-2025), masquees des nuages
- **Couvert vegetal** : Meta AI Research / World Resources Institute, Canopy Height Maps v2
- **Indice composite** : normalisation min-max, ponderation egale entre les trois composantes,
  robustesse testee contre deux ponderations alternatives (correlation de rang 0.93 a 0.98)
- **Donnees socio-demographiques** : INSEE, carroyage Filosofi 2021 (200 m), agregees par ilot par
  ponderation surfacique

## Limite importante a garder en tete

L'indice de chaleur mesure un etat diurne structurel, pas la capacite d'un secteur a evacuer la
chaleur la nuit, identifiee par la litterature comme le facteur le plus determinant pour le risque
sanitaire reel. Les donnees demographiques par ilot sont des estimations par interpolation, pas un
recensement direct.

## Structure du depot

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

## Sources de donnees

Toutes les sources sont en licence ouverte (Etalab, ODbL ou CC BY) :

- LCZ : Cerema
- Sentinel-2 L2A : Microsoft Planetary Computer
- BD ORTHO : IGN, Geoplateforme
- Landsat 8/9 : Microsoft Planetary Computer (USGS Collection 2)
- Canopy Height Maps v2 : Meta AI Research / World Resources Institute
- Batiments : IGN, Geoplateforme, WFS BDTOPO_V3
- EHPAD : FINESS, via AtlaSante (DREES)
- Ecoles primaires : Ministere de l'Education nationale
- Creches : portail open data de la ville de Niort
- Revenus et population : INSEE, Filosofi et Recensement de la population
- Geocodage d'adresse : API Adresse, Base Adresse Nationale
