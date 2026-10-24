# Security Policy

## 🛡️ Security Overview

Strata is a decentralized trading platform built on the Asentum blockchain. Security is paramount for protecting user funds and ensuring the integrity of on-chain strategies.

## 🔒 Security Features

### On-Chain Security

1. **Source Code Verification**
   - BLAKE3 hash verification ensures deployed code matches source
   - Source code stored permanently on-chain
   - Public verification by anyone

2. **Re-entry Protection**
   - Asynchronous cross-contract calls prevent re-entrancy attacks
   - Failed transactions revert atomically
   - No partial execution states

3. **Gas Escrow Management**
   - Pre-funded gas limits prevent runaway execution
   - Kill switch refunds remaining escrow
   - Transaction-level gas estimation

4. **Immutable Logic**
   - Once deployed, strategy code cannot be altered
   - No upgrade mechanisms that could introduce vulnerabilities
   - Deterministic execution

### Client-Side Security

1. **Wallet Security**
   - Private keys never exposed to browser
   - Wallet only signs transactions
   - No key storage in application

2. **Seed Management**
   - Deterministic seed generation
   - Local storage in git-ignored directory
   - Manual funding required (prevents accidental deployments)

3. **Input Validation**
   - TypeScript type checking
   - Parameter validation before deployment
   - RPC response validation

## 🐛 Reporting Security Issues

### Responsible Disclosure

If you discover a security vulnerability, please report it responsibly.

**Do NOT:**
- Create a public issue
- Discuss the vulnerability publicly
- Exploit the vulnerability
- Share details with third parties

**DO:**
- Send details to the maintainers privately
- Provide sufficient information to reproduce
- Allow time for investigation and fix
- Follow disclosure timeline

### How to Report

Send security reports to:
- Email: security@asentum.com
- Include "SECURITY: Strata" in subject line
- Provide detailed description of the vulnerability
- Include steps to reproduce if possible
- Include suggested fix if applicable

### What to Include

- Clear description of the vulnerability
- Impact assessment
- Steps to reproduce
- Proof of concept (if applicable)
- Environment details
- Suggested remediation

### Disclosure Timeline

1. **Initial Response** - Within 48 hours
2. **Investigation** - Up to 7 days
3. **Fix Development** - Up to 14 days
4. **Coordination** - Up to 7 days
5. **Public Disclosure** - After fix is deployed

Timeline may vary based on severity and complexity.

## 🔍 Security Best Practices

### For Strategy Developers

1. **Test Thoroughly**
   - Test on testnet before mainnet deployment
   - Verify BLAKE3 hash matches
   - Audit contract logic

2. **Secure Your Keys**
   - Never share private keys
   - Use hardware wallets for large amounts
   - Keep seed phrases offline

3. **Monitor Strategies**
   - Review execution logs regularly
   - Check gas consumption
   - Verify expected behavior

4. **Start Small**
   - Deploy with small amounts first
   - Increase gradually as confidence grows
   - Use kill switch if issues arise

### For Users

1. **Verify Strategies**
   - Check BLAKE3 hash before funding
   - Review source code
   - Only fund verified strategies

2. **Secure Your Wallet**
   - Use reputable wallet software
   - Enable 2FA if available
   - Keep software updated

3. **Understand Risks**
   - Smart contracts can have bugs
   - On-chain transactions are irreversible
   - Test thoroughly with small amounts

## 🚨 Known Security Considerations

### Current Limitations

1. **Template Validation**
   - Templates not yet deployed to mainnet
   - Placeholder addresses require manual replacement
   - Live deployment testing needed

2. **Gas Estimation**
   - Gas costs may vary with network conditions
   - Insufficient gas causes transaction failure
   - Monitor gas consumption regularly

3. **Oracle Dependence**
   - TWAP oracle relies on AMM activity
   - Low liquidity pools may have inaccurate prices
   - Consider pool activity before deployment

### Mitigation Strategies

1. **Use Testnet**
   - Deploy and test on testnet first
   - Verify all functionality
   - Check gas consumption patterns

2. **Start with Small Amounts**
   - Initial deployments with minimal funds
   - Monitor execution carefully
   - Scale up gradually

3. **Diversify**
   - Don't put all funds in one strategy
   - Use multiple strategies
   - Spread risk across different pools

## 🔐 Audits

### Audit Status

Strata has not yet undergone a formal security audit. However:

- Code review by maintainers
- Community review encouraged
- Testnet deployment testing
- Bug bounty program planned

### Planned Audits

- Formal smart contract audit
- Web application security audit
- Penetration testing
- Regular security reviews

## 📞 Security Contact

For security-related questions or to report vulnerabilities:

- **Email:** security@asentum.com
- **PGP Key:** Available on request
- **Response Time:** Within 48 hours

## 🔄 Security Updates

### Changelog

Security updates will be documented in:
- GitHub Security Advisories
- Release notes
- Blog posts

### Notification

Subscribe to security updates:
- GitHub releases
- Asentum blog
- Security mailing list

## 📜 Security Policy Version

This policy is version 1.0, last updated October 23, 2026.

---

For general issues, see [BUGS.md](../BUGS.md)
For contributing, see [CONTRIBUTING.md](../CONTRIBUTING.md)
