# Contributing to Strata

Thank you for your interest in contributing to Strata! This document provides guidelines and instructions for contributing to the project.

## 📋 Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Pull Request Process](#pull-request-process)
- [Coding Standards](#coding-standards)
- [Testing](#testing)
- [Documentation](#documentation)

## 🤝 Code of Conduct

We are committed to providing a welcoming and inclusive environment. Please:

- Be respectful and constructive
- Welcome newcomers and help them learn
- Focus on what is best for the community
- Show empathy towards other community members

## 🚀 Getting Started

### Prerequisites

- Node.js 18 or higher
- npm or yarn
- Git

### Setup

1. Fork the repository
2. Clone your fork:
   ```bash
   git clone https://github.com/your-username/strata.git
   cd strata
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Create a feature branch:
   ```bash
   git checkout -b feature/your-feature-name
   ```

## 🔄 Development Workflow

### Making Changes

1. Make your changes in the appropriate directory
2. Follow the [Coding Standards](#coding-standards)
3. Test your changes locally
4. Commit your changes with a clear message
5. Push to your fork
6. Create a Pull Request

### Branch Naming

Use descriptive branch names:
- `feature/` - New features
- `fix/` - Bug fixes
- `docs/` - Documentation changes
- `refactor/` - Code refactoring
- `test/` - Test additions or changes

Example: `feature/add-dca-strategy-template`

## 📝 Pull Request Process

### Before Submitting

1. **Run linter:**
   ```bash
   npm run lint
   ```

2. **Build the project:**
   ```bash
   npm run build
   ```

3. **Test your changes:**
   ```bash
   npm run dev
   ```

4. **Update documentation** if needed

### PR Description

Your Pull Request should include:

- **Title:** Clear and descriptive (e.g., "Add DCA strategy template")
- **Description:** What changes you made and why
- **Related issues:** Link to any related issues
- **Screenshots:** If UI changes, include before/after screenshots
- **Testing:** How you tested your changes

### Review Process

1. Automated checks must pass
2. At least one maintainer review
3. Address feedback in a timely manner
4. Once approved, your PR will be merged

## 📐 Coding Standards

### TypeScript/JavaScript

- Use TypeScript for type safety
- Follow existing code style
- Use meaningful variable and function names
- Add JSDoc comments for complex functions
- Keep functions small and focused

### React Components

- Use functional components with hooks
- Follow the existing component structure
- Use TypeScript interfaces for props
- Keep components reusable
- Separate business logic from UI

### Smart Contracts (JavaScript)

- Use plain JavaScript for contracts (no transpilation)
- Follow the Asentum contract format
- Include clear comments explaining logic
- Use BLAKE3 hash verification
- Test thoroughly before deployment

### Code Style

```bash
npm run lint
```

We use oxlint for linting. Ensure your code passes before submitting.

## 🧪 Testing

### Running Tests

```bash
npm run test  # Run all tests
```

### Chain Verification

```bash
npm run chain:check    # Sanity-check RPC surfaces
npm run chain:verify   # BLAKE3 verification
```

### Writing Tests

- Write tests for new features
- Ensure existing tests still pass
- Test edge cases
- Test contract logic thoroughly

## 📚 Documentation

### When to Update Documentation

- Adding new features
- Changing existing functionality
- Updating API interfaces
- Adding new strategy templates

### Documentation Files

- `README.md` - Project overview and quick start
- `CONTRIBUTING.md` - Contribution guidelines (this file)
- `docs/` - Detailed documentation
- `contracts/README.md` - Strategy contract documentation

### Writing Style

- Be clear and concise
- Use examples where helpful
- Keep it up to date with code changes
- Use consistent formatting

## 🐛 Reporting Bugs

Use the GitHub issue tracker to report bugs. Include:

- Description of the bug
- Steps to reproduce
- Expected behavior
- Actual behavior
- Environment (OS, Node.js version, etc.)
- Screenshots if applicable

## 💡 Feature Requests

We welcome feature requests! Before submitting:

1. Check if the feature already exists
2. Search for similar requests
3. Explain the use case clearly
4. Consider if you can implement it yourself

## 📞 Getting Help

- Open an issue for bugs or questions
- Check existing documentation
- Join the community discussions
- Be patient with responses

## 🎯 Areas for Contribution

We especially welcome contributions in:

- New strategy templates
- UI/UX improvements
- Documentation enhancements
- Bug fixes
- Performance optimizations
- Testing improvements

## ⚖️ License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

Thank you for contributing to Strata! 🎉
