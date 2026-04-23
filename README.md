# Dames LLM — duel de joueurs locaux aguerris

Deux modèles Ollama locaux s'affrontent aux dames internationales (10×10, règles FMJD). Les modèles ne sont plus laissés seuls face au plateau : une couche d'analyse tactique déterministe leur fournit, à chaque coup, les outils qu'ils ne savent pas calculer eux-mêmes — de quoi jouer comme des joueurs expérimentés plutôt que des joueurs du dimanche.

## Prérequis

- Node.js 18+ (testé sur 22)
- Ollama Desktop lancé (API sur `http://127.0.0.1:11434`)

## Installation

```bash
cd dames-llm
npm install
ollama pull llama3.2:3b
ollama pull qwen2.5:3b
```

## Lancer

### Mode web

```bash
npm run web
```

Puis **http://localhost:3000**.

### Mode terminal

```bash
npm start
```

### Changer de modèles

```bash
WHITE_MODEL=llama3.2:3b BLACK_MODEL=qwen2.5:3b npm run web
```

## Ce qui rend les modèles "expérimentés"

### 1. Évaluateur de position déterministe (`evaluator.js`)

Chaque position est évaluée par une fonction heuristique : matériel (pion = 100, dame = 320), avancement vers la promotion, contrôle du centre, défense de la dernière rangée, pénalité pour pions collés au bord. C'est le socle — ça donne un score numérique que le LLM peut comparer.

### 2. Recherche 1-ply avec minimax

Pour chaque coup légal, le moteur simule : *je joue X, l'adversaire joue sa meilleure réponse, où en est la position ?* Les coups sont classés et étiquetés (`excellent`, `solide`, `discutable`, `mauvais`). Ça suffit à éviter toutes les gaffes type "je suspends un pion gratos".

### 3. Détection de menaces

Avant chaque coup, on calcule : *si je passe mon tour, que prend l'adversaire ?* Les cases des pièces menacées sont signalées dans le prompt, avec la rafle maximale adverse.

### 4. Prompt système enrichi

Le system prompt contient les principes du jeu (prise maximale obligatoire, valeur des dames, importance de la dernière rangée, etc.) et rappelle que le modèle doit raisonner comme un joueur chevronné.

### 5. Chain-of-thought structuré

La réponse attendue est un JSON :

```json
{
  "thinking": "raisonnement en 2-4 phrases",
  "move": "32-28",
  "confidence": "medium"
}
```

Le prompt utilisateur présente la position, le matériel, l'évaluation statique, les menaces, les opportunités, et les 5-6 meilleurs coups candidats pré-annotés — le LLM n'a plus qu'à choisir en arbitrant entre les options.

### 6. Mémoire entre parties (`memory.json`)

À la fin de chaque partie, chaque modèle écrit une leçon actionnable de ~250 caractères. Les 10 dernières leçons du même camp (+ quelques-unes côté adverse) sont réinjectées dans le system prompt des parties suivantes. Désactivable avec `REFLECT=0`.

### 7. Retry avec feedback + fallback

Si le modèle produit un JSON invalide ou un coup absent de la liste légale, on relance avec une température plus haute et l'erreur en contexte. Au bout de 3 échecs, le système joue le coup numéro 1 du ranking (pas un coup aléatoire) et le marque `[fallback]` dans l'interface.

## Ce que tu vois dans l'interface web

- **Plateau** avec surbrillance jaune du dernier coup (départ + arrivée) et contour rouge pointillé des pièces qui viennent d'être capturées
- **Panneau d'analyse** : phase de jeu, évaluation statique, menaces actives, top 5 des candidats avec leur verdict coloré (vert/bleu/orange/rouge), riposte adverse anticipée
- **Historique des coups** avec le raisonnement du modèle, son niveau de confiance et le temps de réflexion
- **Leçons apprises** en bas de page à la fin de chaque partie

## Structure

| Fichier | Rôle |
|---|---|
| `engine.js` | Règles FMJD, coups légaux, rendu, notation PDN |
| `evaluator.js` | Éval de position, minimax 1-ply, détection menaces/opportunités |
| `agent.js` | Pont Ollama, prompt enrichi, chain-of-thought, réflexion post-partie |
| `memory.js` | Persistence des leçons entre parties (`memory.json`) |
| `server.js` | Serveur HTTP + SSE |
| `index.js` | Mode terminal |
| `public/index.html` | Interface web |

## Variables d'environnement

- `WHITE_MODEL`, `BLACK_MODEL` — noms Ollama des modèles
- `OLLAMA_HOST` — hôte non-défaut (ex. `http://remote:11434`)
- `PORT` — port du serveur web (défaut 3000)
- `REFLECT=0` — désactiver la phase de réflexion post-partie

## Limites honnêtes

Même enrichis, des modèles 3B ne jouent pas à niveau tournoi. Ils évitent maintenant les gaffes évidentes (pièces en prise, rafles ratées) et respectent les principes de base, mais le jeu tactique complexe (coups préparatoires, sacrifices calculés sur 3-4 plis, finales théoriques) reste hors de portée. Passe à des modèles plus grands ou augmente la profondeur de recherche si tu veux plus.

## Pistes pour aller plus loin

- **Recherche 2-3 plies** : triple le coût CPU mais détecte les tactiques courtes
- **Opening book FMJD** : les 5-6 premiers coups joués depuis un répertoire connu
- **Évaluation plus riche** : mobilité des pièces, classique/moderne, structure des pions
- **Annotation par un vrai moteur** (Scan) en parallèle pour mesurer combien de gaffes on évite
- **Match-tournoi** : boucle externe qui enchaîne 20-50 parties pour que la mémoire s'épaississe vraiment
