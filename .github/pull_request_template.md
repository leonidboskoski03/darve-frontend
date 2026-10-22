Describe the concrete problem and resulting behavior. Link the owning task record.

Validation: relevant local checks, current source/build/contract identity and remaining acceptance gaps.

- [ ] Task target is `dev`; release target is `main` from this repository's `dev` or `hotfix/*`.
- [ ] Relevant local frontend tests pass; light development CI is distinct from full release/browser acceptance.
- [ ] Selected design, API contracts, authority/cache/privacy boundaries and reduced-motion behavior are preserved or intentional changes are documented and tested.
- [ ] Backend/provider/OBS/sandbox acceptance is recorded at the actual layer, with remaining external prerequisites explicit.
- [ ] Post-merge ancestry/branch cleanup and main-to-dev synchronization are planned; unfinished work is preserved.
- [ ] Deployment, persistent migration and live payment activation remain separately authorized.
