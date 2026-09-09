/**
 * Tests unitaires : services metier, dependances mockees.
 *
 * Pourquoi cette configuration en mode ESM.
 *
 * NestJS 12 est distribue UNIQUEMENT en ESM ("type": "module", aucun build
 * CommonJS). L application, compilee en CommonJS, fonctionne parce que Node 22
 * sait charger un module ESM depuis un require(). Le runtime de Jest, lui,
 * refuse ce pont en dessous de Node 24.9 et echoue sur
 * "Must use import to load ES Module".
 *
 * Jest est donc execute en mode ESM natif : ts-jest emet de l ESM, et les tests
 * sont lances avec NODE_OPTIONS=--experimental-vm-modules (voir le script
 * `test` du package.json). Aucune version n a eu besoin d etre changee.
 *
 * Le seuil de couverture ne portera QUE sur les modules ou le risque est reel
 * (expiration des liens, verification du PIN, transitions de statut). Pas de
 * seuil global : un pourcentage moyen ne dit rien.
 */
module.exports = {
  rootDir: '.',
  roots: ['<rootDir>/src'],
  moduleFileExtensions: ['js', 'json', 'ts'],
  testRegex: '.*\.spec\.ts$',
  extensionsToTreatAsEsm: ['.ts'],
  transform: {
    '^.+\.ts$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: { module: 'esnext', target: 'es2023', verbatimModuleSyntax: false },
      },
    ],
  },
  collectCoverageFrom: ['src/**/*.(t|j)s'],
  coverageDirectory: 'coverage',
  testEnvironment: 'node',
  coveragePathIgnorePatterns: ['\.module\.ts$', 'main\.ts$', '\.dto\.ts$'],
};
