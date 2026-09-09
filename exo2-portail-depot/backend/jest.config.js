/**
 * Tests unitaires : services metier, dependances mockees.
 * Le seuil de couverture ne porte QUE sur les modules ou le risque est reel
 * (expiration des liens, verification du PIN, transitions de statut).
 * Pas de seuil global : un pourcentage moyen ne dit rien.
 */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\.spec\.ts$',
  transform: { '^.+\.ts$': 'ts-jest' },
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  coveragePathIgnorePatterns: ['\.module\.ts$', 'main\.ts$', '\.dto\.ts$'],
};
