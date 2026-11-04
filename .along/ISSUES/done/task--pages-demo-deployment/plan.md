# Plan: Deploy docs and demo to GitHub Pages for LiveStruct

## Objective
Enable GitHub Pages and automated docs and demo deployment on actdim/livestruct identically to dynstruct.

## Steps
1. Enable GitHub Pages on actdim/livestruct repository via GitHub API.
2. Align `.github/workflows/pages.yml` with dynstruct pipeline.
3. Update package.json and demo/package.json for peer dependency resolution.
4. Verify GitHub Actions workflow run and live endpoints.
