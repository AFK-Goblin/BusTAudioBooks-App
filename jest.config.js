module.exports = {
  preset: "jest-expo",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.js"],
  testPathIgnorePatterns: ["<rootDir>/desktop/", "<rootDir>/dist/", "<rootDir>/dist-check/", "<rootDir>/.worktrees/"],
  modulePathIgnorePatterns: ["<rootDir>/desktop/", "<rootDir>/.worktrees/"],
};
