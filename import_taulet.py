import os
import re
import json
import time
import random
import shutil
from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright

# Cible les deux emplacements possibles pour Netlify
HTML_TARGETS = [f for f in ["public/index.html", "index.html"] if os.path.exists(f)]
IMG_DIRS = ["public/images/taulet", "images/taulet"]
for d in IMG_DIRS:
    os.makedirs(d, exist_ok=True)

MARGE = 1.30       # +30% de marge hors frais de livraison
TVA_SEULE = 1.20   # TVA 20% livraison seule
TVA_POSE = 1.10    # TVA 10% avec pose

def nettoyer_nom_fr(titre_es):
    nom = titre_es.upper()
    nom = nom.replace("ANTID.", "").replace("ANTID", "").replace("ANTISLIP", "")
    nom = nom.replace("1ª CALIDAD", "").replace("COMERCIAL", "").replace("RECT.", "").replace("RECT", "")
    nom = nom.replace("SHOELESS PLUS", "").replace("SHOELESS", "").replace("SHOELES", "")
    nom = re.sub(r'\b[A-Z0-9]{4}\b', '', nom)
    nom = re.sub(r'\s+', ' ', nom).strip().title()
    return nom

def extraire_format(titre_es):
    match = re.search(r'(\d{2,3})\s*[xX]\s*(\d{2,3})', titre_es)
    fmt = f"{match.group(1)}x{match.group(2)} cm" if match else "60x60 cm"
    if "20MM" in titre_es.upper() or "20 MM" in titre_es.upper():
        return f"{fmt} (Ép. 20mm)"
    return fmt

def generer_description_seo(nom_propre, titre_es, fmt_str, est_20mm):
    t = titre_es.upper()
    if any(k in t for k in ["BEIGE", "CREMA", "ARENA", "SAND"]):
        couleur = "beige chaleureux aux nuances minérales naturelles"
    elif any(k in t for k in ["GRIS", "GREY", "CEMENTO", "ANTRACITA", "GRAFITO"]):
        couleur = "gris contemporain élégant et lumineux"
    elif any(k in t for k in ["WHITE", "BLANCO", "PERLA"]):
        couleur = "blanc minéral épuré qui agrandit visuellement l'espace"
    elif any(k in t for k in ["MADERA", "ROBLE", "HAYA", "NATURAL", "OAK"]):
        couleur = "ton bois naturel authentique au veinage nuancé"
    else:
        couleur = "teinte naturelle intemporelle facile à harmoniser"

    if any(k in t for k in ["MADERA", "ROBLE", "WOOD"]):
        style = "parquet céramique imitation bois"
    elif any(k in t for k in ["UNDERGROUND", "CEMENTO", "BETON", "VELVET"]):
        style = "grès cérame effet béton ciré"
    elif any(k in t for k in ["PIEDRA", "STONE", "BOREAL", "TRAVERTINO"]):
        style = "grès cérame effet pierre naturelle"
    else:
        style = "carrelage grès cérame pleine masse"

    if est_20mm:
        return (
            f"Dalle terrasse extérieure 20 mm {nom_propre} ({fmt_str}), {style} coloris {couleur}. "
            f"Classée antidérapante R11 et totalement ingélive, cette dalle forte épaisseur est conçue pour une pose sur plots réglables, sur gravier, sur sable ou collée sur chape béton. "
            f"Idéale pour sécuriser vos plages de piscine, terrasses suspendues et allées de jardin sans entretien particulier. Disponible en livraison directe partout en France ou avec pose garantie décennale."
        )
    return (
        f"Carrelage extérieur antidérapant R11 {nom_propre} au format {fmt_str} : un {style} au coloris {couleur}. "
        f"Sa surface structurée haute adhérence garantit une sécurité optimale pieds nus ou mouillés sur terrasse, balcon, contour de piscine et entrée de maison. "
        f"Résistant au gel, aux UV et aux taches, ce grès cérame rectifié permet des joints fins et soignés. Tarif direct négoce avec livraison France entière ou pose par nos artisans."
    )

def aspirer_taulet():
    catalogue_taulet = []

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=["--disable-blink-features=AutomationControlled"]
        )
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
            viewport={"width": 1920, "height": 1080},
            locale="fr-FR"
        )
        page_nav = context.new_page()

        for page in range(1, 7):
            url = (
                "https://tau-let.com/categoria-producto/pavimento/pavimento-antideslizante/"
                if page == 1
                else f"https://tau-let.com/categoria-producto/pavimento/pavimento-antideslizante/page/{page}/"
            )
            print(f"Navigation page {page}/6 : {url}")
            page_nav.goto(url, wait_until="domcontentloaded", timeout=60000)

            try:
                page_nav.wait_for_selector("li.product", timeout=15000)
            except Exception:
                page_nav.wait_for_timeout(6000)

            page_nav.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            page_nav.wait_for_timeout(2000)

            soup = BeautifulSoup(page_nav.content(), "html.parser")
            produits_page = soup.select("li.product")
            print(f"  -> {len(produits_page)} produits détectés sur la page {page}")

            for item in produits_page:
                titre_el = item.select_one("h2, .woocommerce-loop-product__title")
                if not titre_el:
                    continue

                titre_es = titre_el.get_text(strip=True)
                texte_carte = item.get_text(" ", strip=True)

                prix_match = re.search(r'(\d+[.,]\d{2})\s*€', texte_carte)
                if not prix_match:
                    prix_match = re.search(r'€\s*(\d+[.,]\d{2})', texte_carte)
                prix_achat_ht = float(prix_match.group(1).replace(',', '.')) if prix_match else 0.0

                if prix_achat_ht <= 0:
                    continue

                prix_supply_ttc = round(prix_achat_ht * MARGE * TVA_SEULE, 2)
                prix_pose_ttc = round(prix_achat_ht * MARGE * TVA_POSE, 2)
                old_price_ttc = round(prix_supply_ttc * 1.42, 2)

                en_stock = "añadir" in texte_carte.lower() or "carrito" in texte_carte.lower()

                est_20mm = "20MM" in titre_es.upper() or "20 MM" in titre_es.upper()
                categorie = "Extérieur R11" if est_20mm else "Carrelage Extérieur"
                norme = (
                    "R11 Antidérapant • Ép. 20mm • Pose Plots/Collée"
                    if est_20mm
                    else "R11 Antidérapant • 1er Choix Rectifié"
                )
                box_sqm = 0.72 if est_20mm else 1.44

                slug = re.sub(r'[^a-z0-9]+', '-', titre_es.lower()).strip('-')[:45]
                prod_id = f"taulet-{slug}"
                img_el = item.select_one("img")
                img_url = (img_el.get("data-large_image") or img_el.get("data-src") or img_el.get("src")) if img_el else ""

                chemin_web_img = "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=1600&q=85"
                if img_url and not img_url.startswith("data:"):
                    ext = ".webp" if ".webp" in img_url.lower() else ".jpg"
                    nom_fichier = f"{slug}{ext}"
                    try:
                        resp_img = context.request.get(img_url, timeout=15000)
                        if resp_img.ok:
                            img_data = resp_img.body()
                            for d in IMG_DIRS:
                                with open(os.path.join(d, nom_fichier), "wb") as f:
                                    f.write(img_data)
                            chemin_web_img = f"/images/taulet/{nom_fichier}"
                    except Exception as e:
                        print(f"  [!] Erreur image pour {titre_es} : {e}")

                nom_propre = nettoyer_nom_fr(titre_es)
                fmt_str = extraire_format(titre_es)
                titre_seo = f"Dalle Extérieure 20mm {nom_propre}" if est_20mm else f"Carrelage Extérieur R11 {nom_propre}"
                desc_seo = generer_description_seo(nom_propre, titre_es, fmt_str, est_20mm)

                catalogue_taulet.append({
                    "id": prod_id,
                    "name": titre_seo,
                    "category": categorie,
                    "format": fmt_str,
                    "discount": "-30%",
                    "oldPrice": old_price_ttc,
                    "priceSupply": prix_supply_ttc,
                    "pricePose": prix_pose_ttc,
                    "boxSqm": box_sqm,
                    "norm": norme,
                    "inStock": en_stock,
                    "images": [chemin_web_img],
                    "desc": desc_seo
                })

            time.sleep(random.uniform(4.5, 7.5))

        browser.close()
    return catalogue_taulet

def injecter_dans_tous_les_html(nouveaux_produits):
    if not nouveaux_produits:
        print("Aucun produit à injecter.")
        return

    lignes_nouveaux = []
    for prod in nouveaux_produits:
        bloc_json = json.dumps(prod, ensure_ascii=False, indent=4)
        bloc_indente = "\n".join("            " + ligne for ligne in bloc_json.splitlines())
        lignes_nouveaux.append(bloc_indente)
    nouveau_bloc_js = ",\n".join(lignes_nouveaux)

    for fichier_html in HTML_TARGETS:
        with open(fichier_html, "r", encoding="utf-8") as f:
            contenu_html = f.read()

        pattern = re.compile(r'(let\s+products\s*=\s*)\[([\s\S]*?)\](\s*;)', re.MULTILINE)
        match = pattern.search(contenu_html)
        if not match:
            print(f"[Ignoré] Bloc 'let products = [...];' absent de {fichier_html}.")
            continue

        bloc_existant = match.group(2).strip()
        if "taulet-" in bloc_existant:
            idx_premier_taulet = bloc_existant.find('"id": "taulet-')
            if idx_premier_taulet != -1:
                debut_objet = bloc_existant.rfind("{", 0, idx_premier_taulet)
                bloc_base = bloc_existant[:debut_objet].rstrip().rstrip(",")
                contenu_final_tableau = f"{bloc_base},\n{nouveau_bloc_js}" if bloc_base else nouveau_bloc_js
            else:
                contenu_final_tableau = f"{bloc_existant},\n{nouveau_bloc_js}"
        else:
            contenu_final_tableau = f"{bloc_existant},\n{nouveau_bloc_js}" if bloc_existant else nouveau_bloc_js

        nouveau_html = (
            contenu_html[:match.start()]
            + f"{match.group(1)}[\n{contenu_final_tableau}\n        ]{match.group(3)}"
            + contenu_html[match.end():]
        )

        with open(fichier_html, "w", encoding="utf-8") as f:
            f.write(nouveau_html)
        print(f"Injection réussie dans '{fichier_html}' ({len(nouveaux_produits)} modèles) !")

if __name__ == "__main__":
    print(f"Fichiers HTML détectés : {HTML_TARGETS}")
    produits_extraits = aspirer_taulet()
    print(f"Total récupéré : {len(produits_extraits)} carreaux.")
    injecter_dans_tous_les_html(produits_extraits)
