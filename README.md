# Dames LLM — deux agents locaux qui s'affrontent

Démo minimale : deux modèles Ollama locaux jouent une partie de dames internationales (10×10, règles FMJD) l'un contre l'autre. Le moteur Node.js tient l'état du plateau, valide les coups et empêche toute triche du modèle.

## Prérequis

- Node.js 18+ (testé sur 22)
- Ollama Desktop lancé (il expose son API sur `http://127.0.0.1:11434`)

## Installation

```bash
cd dames-llm
npm install
```

## Télécharger deux modèles

Sur ton MacBook Pro M1 Pro 16 Go, deux modèles 3B tournent bien en parallèle (~2 Go chacun, Ollama les garde chauds) :

```bash
ollama pull llama3.2:3b
ollama pull qwen2.5:3b
```

Si tu veux pousser un peu, tu peux tester `phi3.5` ou `gemma2:2b`. Éviter deux 7B en même temps sur 16 Go : ça va swapper.

Astuce : pour que les deux modèles restent chargés en RAM simultanément, lance Ollama avec
```bash
OLLAMA_MAX_LOADED_MODELS=2 ollama serve
```
(l'app Desktop gère ça automatiquement si la RAM le permet).

## Lancer une partie

### Mode web (recommandé)

```bash
npm run web
```

Puis ouvre **http://localhost:3000** dans le navigateur. Clique sur « Lancer une partie » : le plateau se met à jour coup par coup (streaming via Server-Sent Events), avec surbrillance du dernier coup joué, pièces capturées, pensées du modèle et compteur de matériel.

### Mode terminal

```bash
npm start
```

Plateau ASCII et journal PDN imprimés dans la console.

### Choix des modèles

```bash
WHITE_MODEL=llama3.2:3b BLACK_MODEL=qwen2.5:3b npm run web
```

## Structure

- `engine.js` — moteur du jeu (règles, coups légaux, rendu, notation)
- `agent.js` — wrapper Ollama avec retries et fallback aléatoire si le modèle produit un coup invalide
- `index.js` — boucle principale (mode terminal)
- `server.js` — serveur HTTP + Server-Sent Events (mode web)
- `public/index.html` — interface web

## Ce qui marche / limites

✅ Règles implémentées : mouvements de pions et dames, prises courtes et volantes, prise obligatoire, règle de la rafle maximale, promotion, détection de fin de partie (pat ou nulle 25 coups sans progression).

⚠️ Le moteur empêche les coups illégaux — si un modèle propose une bêtise, on retry jusqu'à 3 fois avec une température croissante, puis on tire un coup au hasard pour que la partie continue. En pratique, les petits modèles jouent assez mal aux dames : ne t'attends pas à du niveau tournoi. C'est de la démo.

## Pistes d'amélioration

- Forcer un format de réflexion plus riche (chain-of-thought, évaluation matérielle) pour voir si ça améliore le niveau
- Logger les parties au format PDN standard pour les rejouer
- Ajouter un petit rendu HTML/SVG pour l'animation
- Brancher un vrai moteur (Scan) comme arbitre/commentateur pour annoter les bévues
# dames-llm-locally
