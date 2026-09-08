# Exercice 1 - exo1-sans-ia

## 01 Setup 

- run ces 2 commandes : "cd advent-of-code" puis "node solution.js".
- ca permets de tester le code ecrit.
requirements : avoir Node.js

## 02 Workflow

- Extraction du texte de `solution.txt` pour transformer en grille (tableau 2D), plus simple pour naviguer avec des index ligne/colonne.
- Recherche de la position du garde (`^`) dans la grille, gestion des directions via un tableau (évite les fonctions auxiliaires) : rotation à droite gérée avec `+1` puis modulo 4.
- Simulation : le garde avance case par case, tourne à droite si `#` devant lui, en partant de haut → droite → bas → gauche. Stockage des cases visitées dans un `Set`.
- Partie 2 : fonction auxiliaire de simulation réutilisée à chaque case vide remplacée par un obstacle test, même logique que la partie 1. Détection de boucle : repasser par la même position + la même direction (paire stockée dans un `Set`).

## 03 Tests

Testé avec le fichier d'input réel (`solution.txt`) :
- Partie 1 : 4374 positions distinctes visitées.
- Partie 2 : 1705 positions provoquant une boucle infinie.

Résultats obtenus après correction d'un bug où la fonction de simulation utilisait par erreur la grille originale (`grille`) au lieu de la grille avec l'obstacle test (`newGrille`), ce qui donnait initialement 0 boucles détectées.

## 04 Ameliorations

- Améliorer la structuration du code (variables et fonctions mieux organisées, actuellement écrit rapidement).
- Ajouter une vérification sur l'exemple simplifié de l'énoncé en plus du test sur l'input réel.
- Optimiser la partie 2 (actuellement teste exhaustivement chaque case vide, complexité élevée sur une grande grille).
- Ajouter des tests automatisés plutôt qu'une vérification manuelle.

## 05 Preuves

Lien de l'enregistrement : https://drive.google.com/file/d/1U6r2nbyXuReiTMEJbyku726uu5-nNrR_/view?usp=sharing