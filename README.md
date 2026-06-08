# Project Name (my-site)

This project implements a frontend web application using React, TypeScript, and Vite for bundling.

## Technical Specifications

The application relies on the following major libraries:
*   `react`: Version ^19.2.6
*   `react-dom`: Version ^19.2.6
*   `react-router-dom`: Version ^7.15.0

The build process utilizes TypeScript (`typescript`) for type checking and compilation, and Vite (v8.0.12) for bundling. The configuration specifies:
*   **Target Environment:** ES2023 / DOM standard library definitions.
*   **Module Resolution:** `bundler` mode is configured in `tsconfig-node.json` and `tsconfig-app.json`.

## Setup Instructions

To run the project, clone the repository and install dependencies:

```bash
npm install
```

The application entry point is defined in `./index.html`, which loads `/src/main.tsx` as a module.

## Commands

Use the following `npm` scripts to execute specific tasks:

*   **Development Server:** Runs the project using Vite for local development.
    ```bash
    npm run dev
    # Executes 'vite'
    ```

*   **Build Production Bundle:** Compiles TypeScript and then builds the production assets via Vite.
    ```bash
    npm run build
    # Executes 'tsc -b && vite build'
    ```
    *The compiled output is written to the `./dist` directory.*

*   **Linting:** Runs ESLint against all files in the project directory.
    ```bash
    npm run lint
    # Executes 'eslint .'
    ```

*   **Preview:** Serves the built production assets locally for testing.
    ```bash
    npm run preview
    # Executes 'vite preview'
    ```

## Deployment Workflow

The repository includes a GitHub Actions workflow located at `/.github/workflows/static.yml` configured for deployment to GitHub Pages.

### Build Process Details (GitHub Actions)
When triggered by a push to the `main` branch or manually via `workflow_dispatch`, the following steps execute:
1.  Checks out the repository contents (`actions/checkout@v4`).
2.  Configures Node.js environment version 24 (`actions/setup-node@v4`).
3.  Installs dependencies using `npm ci`.
4.  Executes the build script via `npm run build`.
5.  Uploads artifacts from the `./dist` directory using `actions/upload-pages-artifact@v3`.
6.  Deploys the artifact to GitHub Pages using `actions/deploy-pages@v5`.

### Custom Fallback Page
A custom 404 error page is available at `./public/404.html`. This file contains specific CSS styling and structure for handling unrouted requests.