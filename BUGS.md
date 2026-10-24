# Known Issues and Bugs

This document tracks known issues and bugs in the Strata project.

## 🐛 Current Issues

### Deployment Scripts

#### Issue: Seed File in Git-ignored Directory
- **Status:** Documented behavior
- **Description:** The deployer generates a deterministic-seed wallet stored in `.strata/seed.json`, which is git-ignored. This is intentional for security reasons.
- **Impact:** Users must manually fund the generated wallet address before deployment.
- **Workaround:** Follow the deployment steps in README.md to fund the wallet after address generation.

### Contract Templates

#### Issue: Placeholder Addresses
- **Status:** Pending
- **Description:** Contract templates use placeholder constants (`BASE`, `POOL_TOKEN`, `QUOTE_TOKEN`) that must be replaced with real token addresses before deployment.
- **Impact:** Direct deployment without address replacement will fail.
- **Workaround:** Manually replace placeholder addresses in contract files before deployment.
- **Proposed Fix:** Add automated address replacement in deploy scripts.

#### Issue: Templates Not Deployed
- **Status:** Documented limitation
- **Description:** Templates have not been deployed to live chain yet. They are written against documented VM globals but not exercised against a live node.
- **Impact:** Cannot verify actual on-chain behavior until live deployment.
- **Workaround:** Use testnet for initial deployment and testing.

### Web Application

#### Issue: Chain RPC Health Check
- **Status:** Working as intended
- **Description:** `npm run chain:check` performs sanity checks on RPC surfaces but requires active blockchain connection.
- **Impact:** Fails if blockchain RPC is unavailable.
- **Workaround:** Ensure blockchain RPC is accessible before running check.

## 🔧 Fixed Issues

*No fixed issues to report at this time.*

## 📋 Feature Requests

### Deployment Automation
- Add support for automatic address replacement in deploy scripts
- Add dry-run mode for deployment testing
- Add strategy validation before deployment

### Web Application
- Add strategy performance dashboard
- Add strategy comparison tools
- Add strategy backtesting features

### Documentation
- Add video tutorials for strategy deployment
- Add more detailed examples for each template
- Add troubleshooting guide

## 📝 Reporting New Issues

To report a new issue:

1. Check if the issue is already listed
2. Search existing GitHub issues
3. Create a new issue with:
   - Clear title
   - Detailed description
   - Steps to reproduce
   - Expected vs actual behavior
   - Environment details
   - Screenshots/logs if applicable

## 🔍 Issue Triage

Labels used to categorize issues:
- `bug` - Confirmed bug
- `enhancement` - Feature request
- `documentation` - Documentation issue
- `good first issue` - Good for new contributors
- `help wanted` - Community help needed
- `priority: high` - Urgent issue
- `priority: medium` - Normal priority
- `priority: low` - Nice to have

---

Last updated: 2026-10-23
