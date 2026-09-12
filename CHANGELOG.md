# Changelog

## 0.14.0

### Features

#### test

- observe validation group reuse
  ([5742c66](https://github.com/hugojosefson/cli/commit/5742c6672a8f6222d6d316e2dbd4d3a765d28f03))

## 0.13.0

### Features

#### cli

- launch native global installs with Node or Bun
  ([3ab33f0](https://github.com/hugojosefson/cli/commit/3ab33f0b02c9e2dae45f34c773317272cdf3e311))

#### npm

- own the publication README badge
  ([292efa7](https://github.com/hugojosefson/cli/commit/292efa77cfe9d378713f774a544f9867bf710a97))

### Fixes

#### docs

- document native Node and Bun releases
  ([7afdd5d](https://github.com/hugojosefson/cli/commit/7afdd5dbfc6f139ca868aae86ae6bcb14ad6b352))

### Other

#### readme

- organize installation and guides for newcomers
  ([105a9f7](https://github.com/hugojosefson/cli/commit/105a9f7814eb3a875c60a2ca896d778198251200))
- reuse installation commands for upgrades
  ([6a0fea9](https://github.com/hugojosefson/cli/commit/6a0fea9a09d24a36db4b0faf6d8bb0ac44ffa681))
- list supported runtimes separately
  ([5259370](https://github.com/hugojosefson/cli/commit/52593701256f3fe3c50ab099d2efad9f908f8cea))
- describe inspection of the current directory
  ([ea015ac](https://github.com/hugojosefson/cli/commit/ea015ac8e9b42cf792caf0bf1ccb36be6bcfb2df))
- complete Bun and Deno installation options
  ([3dd6fea](https://github.com/hugojosefson/cli/commit/3dd6feaf892f8ff648cd306b83db99e51a0da05e))
- collapse commands that need no global install
  ([f872cb1](https://github.com/hugojosefson/cli/commit/f872cb11b1663567b41b46f82d26178cd4d96f2f))
- remove repeated dependency-age reference
  ([24f4fb1](https://github.com/hugojosefson/cli/commit/24f4fb10c38060b0a8b4a42147ea0ef22bedbf26))

#### runtime

- integrate native launcher and npm badge evidence
  ([c03f06a](https://github.com/hugojosefson/cli/commit/c03f06ac7b0ba995885400783c9eb8d430bedd7b))

## 0.12.0

### Features

#### changelog

- group releases and offer optional history migration
  ([063433c](https://github.com/hugojosefson/cli/commit/063433c6aa86eb7c8a01371efdc702ca4d584e11))

#### release

- publish native CLI archives to npm
  ([281233b](https://github.com/hugojosefson/cli/commit/281233b36eb8b27663ca9028f4e75a6d55d2965c))

### Fixes

#### changelog

- ignore headings inside HTML comments
  ([e223fef](https://github.com/hugojosefson/cli/commit/e223fef9a91db60e0b386f81662979479a25113b))

#### ci

- declare matrix command helper at module scope
  ([727d6ec](https://github.com/hugojosefson/cli/commit/727d6ec1f9fac420d7149007afd8c3d181d42fed))
- replace runtime artifacts when retrying jobs
  ([e6c999d](https://github.com/hugojosefson/cli/commit/e6c999d111505d119ab1cb8011521aa8335215bd))
- use Node 24 artifact actions
  ([7ab05a0](https://github.com/hugojosefson/cli/commit/7ab05a025521ef1ebda0bb2451f1abbd95941061))

#### package

- pin changelog libraries in native dependency locks
  ([fff884f](https://github.com/hugojosefson/cli/commit/fff884f2d66ee10a59b027708f24fa2d6e476624))

### Other

#### changelog

- verify registry and published grouped release data
  ([c87da86](https://github.com/hugojosefson/cli/commit/c87da86ab601f09aef2a53971e8bb72789e3776c))

#### ci

- run shared runtime suites in parallel
  ([8e1aca5](https://github.com/hugojosefson/cli/commit/8e1aca58d3ff947ea1c2730f5ce9f1a62b9346ad))
- cancel superseded pull request checks
  ([c990b1a](https://github.com/hugojosefson/cli/commit/c990b1a4ac41661002f1bbbd58a098e380fe5567))
- cache dependency downloads across workflows
  ([ac3d058](https://github.com/hugojosefson/cli/commit/ac3d0580c9366f2680bbb7cb8d88589745eacb5b))
- apply download caches with precise repair previews
  ([24f27af](https://github.com/hugojosefson/cli/commit/24f27af363070abfe8318d9c828a1229801768e9))
- use Node 24 download caching for the integrated workflows
  ([3d2c2a4](https://github.com/hugojosefson/cli/commit/3d2c2a411df0f3f8d745851e448ee1a84cb5c201))

#### cli

- freeze dependency graph in lazy import isolation
  ([8076e8a](https://github.com/hugojosefson/cli/commit/8076e8a85e82d8400f37bb608b462313f2338630))

#### release

- validate each release candidate once
  ([015de6c](https://github.com/hugojosefson/cli/commit/015de6c016bdd3acde6954a63fc0076bd58d28ac))
- pin publisher with candidate-only validation
  ([a1c22de](https://github.com/hugojosefson/cli/commit/a1c22de97f85698d89e2d88a81b2f65b95cbf98e))
- pin publisher with integrated dependency caches
  ([d388001](https://github.com/hugojosefson/cli/commit/d388001ef499bc6bc4eaef67f73ee2ab8e27185b))
- adopt grouped changelog publishers
  ([cd208d0](https://github.com/hugojosefson/cli/commit/cd208d0f18f3e5a41846ed034c896f6f16d23d12))
- retain integrated publisher improvements
  ([0f289f7](https://github.com/hugojosefson/cli/commit/0f289f7b116f0cdd825ef1e850c3bef0f49604ba))

## 0.11.0

### Features

#### package

- build reproducible native npm archives
  ([4d79e99](https://github.com/hugojosefson/cli/commit/4d79e994a01f798a9160db630716e3e2fa371adf))

#### runtime

- resolve and cache external Deno for project tasks
  ([5112acf](https://github.com/hugojosefson/cli/commit/5112acf44c0c395828dcf116231b3ea9144bb6b5))

### Fixes

#### files

- check current-user access instead of exact modes
  ([f7c5ef1](https://github.com/hugojosefson/cli/commit/f7c5ef1b90d4a436f5debdaf1fd024cc1d1e59ae))
- keep metadata and operation guards permission-neutral
  ([175211c](https://github.com/hugojosefson/cli/commit/175211cbe913f1525a4c96202c4c95032d135ee4))
- preserve content-only workflow inspection
  ([c89caf8](https://github.com/hugojosefson/cli/commit/c89caf86e9a7b37243fdef90ca0266f5ef439be1))

#### license

- recognize equivalent copyright markers and line breaks
  ([2b840ea](https://github.com/hugojosefson/cli/commit/2b840ea05a3a00f9f41e5f9f5f3355a53efe2dc7))

#### package

- normalize archive permissions across build umasks
  ([522ea91](https://github.com/hugojosefson/cli/commit/522ea91db591c1176ea9dc049069c0e0e2418457))

#### release

- refresh tag publisher for native workflows
  ([752fbb5](https://github.com/hugojosefson/cli/commit/752fbb554e7bcb231ede71907a85ddb2dbcd63df))

#### runtime

- clean up closed input and preserve configured formatting
  ([d9be559](https://github.com/hugojosefson/cli/commit/d9be559b5dfaffb92f612281fd756a23a8708212))
- preserve empty-input exits and narrow acquisition permissions
  ([023d96b](https://github.com/hugojosefson/cli/commit/023d96bb18cab2cacae825a236afb6412d62d7b1))

### Other

- require pull requests and verified JSR releases
  ([ebf8117](https://github.com/hugojosefson/cli/commit/ebf811771fbcb611d5bfe5698a900ed943bc08e0))
- record shared runtime matrix validation
  ([6094822](https://github.com/hugojosefson/cli/commit/609482287b33eacb0132d1fcc65050db69415a3f))

#### github-release-publish-jsr

- enable feature
  ([98e9cc7](https://github.com/hugojosefson/cli/commit/98e9cc723d33a193e63b847aedd0aca014579a8f))

#### github-release-publish-tag

- enable feature
  ([619b2a9](https://github.com/hugojosefson/cli/commit/619b2a999cd649ee2ed9842f296704a292569232))

#### package

- isolate native consumer home caches
  ([b8005e2](https://github.com/hugojosefson/cli/commit/b8005e212eaf212d8e4eff16d0e81dcedca204b9))

#### runtime

- run shared node tests across supported runtimes
  ([5ea41a8](https://github.com/hugojosefson/cli/commit/5ea41a8f80605501e63f8df67d6149fb7b84c20e))
- integrate shared tests for external Deno resolution
  ([c18dd0d](https://github.com/hugojosefson/cli/commit/c18dd0dfc3677c32a3432285f84bc0acec7d4bcc))
- exercise lazy dependency imports on native hosts
  ([28a8664](https://github.com/hugojosefson/cli/commit/28a8664cee8c65875b487e5970b1cb9240a74062))
- integrate package tests and reject native skips
  ([70fa7aa](https://github.com/hugojosefson/cli/commit/70fa7aacb54db5a9d65be6274280c90b69108e3c))

## 0.10.0

### Features

#### readme

- build README with a generated feature example
  ([ad2562c](https://github.com/hugojosefson/cli/commit/ad2562c4597f7613790b9f67c3a737aa613ece71))

### Fixes

#### cli

- show setup guidance when commands need it
  ([e723a73](https://github.com/hugojosefson/cli/commit/e723a73bcccf12dcb1f00b263429b98fa2abba4f))

#### readme

- avoid repeating custom installation requirements
  ([3be9b8d](https://github.com/hugojosefson/cli/commit/3be9b8d9154a37c14936b31938779e00dc688576))

### Other

#### readme

- preserve tracked read-only generated output
  ([fb9be0b](https://github.com/hugojosefson/cli/commit/fb9be0b599a7562f379e99d6613a4ebe02ff3793))
- record generation and feature validation
  ([33dca26](https://github.com/hugojosefson/cli/commit/33dca267b4abdc9f7abfd3cec518d05179f828e2))

## 0.9.0

### Features

#### cli

- use portable interactive prompts
  ([f7e755e](https://github.com/hugojosefson/cli/commit/f7e755e2b2559b9ca36324f7afc98a258ad76c60))

#### runtime

- run application APIs natively on Node and Bun
  ([1fed2c9](https://github.com/hugojosefson/cli/commit/1fed2c9ad51fcd560111675e04c7f5ff354da54a))

### Other

#### package

- verify native bundled JSR installation
  ([6035ae6](https://github.com/hugojosefson/cli/commit/6035ae664ffdca44627b48d5b281624ef128fcca))

## 0.8.3

### Fixes

#### cli

- keep feature repair output concise
  ([6d4e261](https://github.com/hugojosefson/cli/commit/6d4e261f08415c3eb550d016bab67c9c7870868b))

## 0.8.2

### Fixes

#### release

- skip duplicate CI for validated release commits
  ([227d500](https://github.com/hugojosefson/cli/commit/227d5005f8954b7fa966ea8fb9fc91e18fa5a15c))

### Other

#### github-ci

- enable feature
  ([1673f35](https://github.com/hugojosefson/cli/commit/1673f353a77a716e65d0fd91623c13c20e8bc122))

#### github-release-publish-tag

- enable feature
  ([8f939d6](https://github.com/hugojosefson/cli/commit/8f939d620fb362ad84cdb33a9908b957dab40157))

## 0.8.1

### Fixes

#### features

- omit redundant repair messages for healthy states
  ([bbdfc08](https://github.com/hugojosefson/cli/commit/bbdfc08d956a647e018148485d0d67aa6b83368e))

## 0.8.0

### Features

#### features

- preview specific repair actions
  ([239c686](https://github.com/hugojosefson/cli/commit/239c68652ddc0046c69f013ae618d61ba9aa19ff))

## 0.7.5

### Fixes

#### git-ignore

- preserve valid entries before custom lines
  ([1d78109](https://github.com/hugojosefson/cli/commit/1d78109ddf4ed5609bdad0996828bcbf38b4387d))

## 0.7.4

### Fixes

#### github

- detect repository features during GraphQL outages
  ([584e9d6](https://github.com/hugojosefson/cli/commit/584e9d6c460323b740e629249697ff25696ba3e3))

## 0.7.3

### Other

- require repository feature detection and repair checks
  ([6947c99](https://github.com/hugojosefson/cli/commit/6947c99c4c06b7f0183b476bc56ce516eeec845a))

## 0.7.2

### Other

#### release

- record verified npm publication
  ([fa4cb1e](https://github.com/hugojosefson/cli/commit/fa4cb1e511126aa59336d50fa7b05d0b3ad3e533))
- verify npm package-name installation
  ([4eb00f6](https://github.com/hugojosefson/cli/commit/4eb00f661b1f5993df3cee6c9dbf3b550304ee0c))

## 0.7.1

### Fixes

#### release

- permit local npm publication commands
  ([c6fa830](https://github.com/hugojosefson/cli/commit/c6fa8301ed09d2ca6ac36a39ce4752c063163880))

## 0.7.0

### Features

#### deno-lib

- teach starter assertions
  ([0bfd89d](https://github.com/hugojosefson/cli/commit/0bfd89d248418d2caaed112dca96223a2ef3aa2d))

#### editorconfig

- add independent editor defaults
  ([a41cec9](https://github.com/hugojosefson/cli/commit/a41cec9bea2fecb05cad63f756017c7662de870a))

#### github

- create and link repositories during setup
  ([5d060e8](https://github.com/hugojosefson/cli/commit/5d060e80c149a2e54647eec93f5327e9e716ec0d))

#### github-ci

- migrate legacy workflows
  ([372ff27](https://github.com/hugojosefson/cli/commit/372ff275bd21a5cf8d9f58d40c6f49aa2306779b))

#### release

- migrate legacy publication workflows and tasks
  ([d4b63b4](https://github.com/hugojosefson/cli/commit/d4b63b48385700fe2a5b46477bbfd0f049809d68))
- publish npm packages after release tags
  ([f89f116](https://github.com/hugojosefson/cli/commit/f89f116a9ed4726fdd67d63e274d9db1b5daa27a))

### Fixes

#### editorconfig

- preserve unowned empty files on removal
  ([e735767](https://github.com/hugojosefson/cli/commit/e735767a36d2e9b856ad8a7fff5720acbe657d1e))

#### github

- accept migrated CI for main protection
  ([b3562e7](https://github.com/hugojosefson/cli/commit/b3562e73601c8946f80ba05db1c9ee8459f2a1de))

#### help

- describe GitHub repository creation
  ([508c9b3](https://github.com/hugojosefson/cli/commit/508c9b3b859aac36ce2137df5697248ec7e321f6))

#### projects

- synchronize areas through additive repair
  ([0bb8808](https://github.com/hugojosefson/cli/commit/0bb8808f53771cbbbde2cad043e1fea52700af1f))

#### release

- preserve formatted npm workflow detection
  ([c12b2a1](https://github.com/hugojosefson/cli/commit/c12b2a130c26483a4daf3cdb28bc4becbf299dc7))

### Other

- record repository feature examples and validation
  ([b492144](https://github.com/hugojosefson/cli/commit/b492144bc601fc8fe0d2975866908917edbd868b))

#### editorconfig

- include feature in registry expectation
  ([861850c](https://github.com/hugojosefson/cli/commit/861850c1931ecac881185f5165e09e081be37691))
- enable feature
  ([684fdf6](https://github.com/hugojosefson/cli/commit/684fdf68a385d64cb6ada50582ef56d7672e3305))

#### release

- guard npm enablement during legacy migration
  ([32a7da0](https://github.com/hugojosefson/cli/commit/32a7da0070b7de674672ce5c1af6a5a2e28a65a7))

## 0.6.0

### Features

#### config

- add non-secret global defaults
  ([b4cec1a](https://github.com/hugojosefson/cli/commit/b4cec1a1f0000cd5a7cd6b077850f2c13a3efcc6))

#### readme

- generate feature-owned package guides
  ([cc514b9](https://github.com/hugojosefson/cli/commit/cc514b9bae25c49b0133f5929bf27006d02ec1ce))
- migrate legacy README sources
  ([95ef08d](https://github.com/hugojosefson/cli/commit/95ef08df594a74ccbd8bec6f7705c34378e8e4e3))

### Fixes

#### features

- preserve offline badges and ignore generated coverage during formatting
  ([722e8fc](https://github.com/hugojosefson/cli/commit/722e8fc2d2d70bdc3848a32ee32220d42650ed31))

#### readme

- attribute cumulative guide blocks to their features
  ([5664a31](https://github.com/hugojosefson/cli/commit/5664a31c38fc58594135dbebef1bf87068bd088f))
- project complete file observations for feature planning
  ([3bf21e7](https://github.com/hugojosefson/cli/commit/3bf21e7e6284fcf07f1f8124328ac3ba5fea82a6))
- retain block ownership after formatting
  ([9a3afd2](https://github.com/hugojosefson/cli/commit/9a3afd24513f2aff99b041fd5cbebeaad6f5efc1))
- preserve unchanged formatted contribution blocks
  ([137efca](https://github.com/hugojosefson/cli/commit/137efcae224ac1580605b6a2e3ab5667dfb992fa))
- preserve custom Install sections during repository adoption
  ([23d0804](https://github.com/hugojosefson/cli/commit/23d08041a144f7f0b71f25547c78fb3be9d03f15))

### Other

- use final project checks during repository feature updates
  ([f3c15ce](https://github.com/hugojosefson/cli/commit/f3c15ce11eea372154c6f5cd5897b313df93b5ec))

#### config

- clarify default feature selection
  ([1bd0bd5](https://github.com/hugojosefson/cli/commit/1bd0bd539b8278062d334b0bb225edd00fc8f3c7))

#### git-ignore

- enable feature
  ([45956d1](https://github.com/hugojosefson/cli/commit/45956d1961af1aea3bb0dc68ba64ef3e7ba6fe9c))

#### github-ci

- enable feature
  ([acb5c30](https://github.com/hugojosefson/cli/commit/acb5c30938272f7abdb7fe8ee347286472d13399))
- enable feature
  ([74befbe](https://github.com/hugojosefson/cli/commit/74befbe5db6ab4c81584dfdef319d5bddb87b647))
- enable feature
  ([1cb5990](https://github.com/hugojosefson/cli/commit/1cb5990a6839fcc99f13fec7f9644f1eac27d842))

#### install

- expect generated coverage formatting exclusion
  ([248da0f](https://github.com/hugojosefson/cli/commit/248da0f5b4df887229b77fea0427156d215b539e))

#### jsr-package

- enable feature
  ([1a661dd](https://github.com/hugojosefson/cli/commit/1a661dd65e6756b3705240cba15bdc21dac128db))
- enable feature
  ([2c01c53](https://github.com/hugojosefson/cli/commit/2c01c534daaeecf8e64ed097682c2c46878bf4e7))

#### readme

- verify package guide commits and require repository examples
  ([ff40c67](https://github.com/hugojosefson/cli/commit/ff40c676de3582bce856eccb5f357f303e919a09))

## 0.5.0

### Features

#### cli

- run final project tasks before feature commits
  ([353bc9d](https://github.com/hugojosefson/cli/commit/353bc9d6e2360248e9c2d4ad707422cb0eecbc94))

#### deno

- manage application lock defaults and explicit ownership
  ([9ee0536](https://github.com/hugojosefson/cli/commit/9ee0536c3110a65092f2ff8e247bbae17cd91018))

#### git

- defer separate feature commits until validation succeeds
  ([d770c29](https://github.com/hugojosefson/cli/commit/d770c298ebb7c6b15b702bd7e2fffe1a22298723))

#### jsr

- discover authenticated scope memberships
  ([2a0d409](https://github.com/hugojosefson/cli/commit/2a0d409f05b47fe2cc8d0ca80b7a45995cc23529))

### Fixes

#### features

- integrate final tasks with shared config and lock commits
  ([e20bffa](https://github.com/hugojosefson/cli/commit/e20bffaf59e5819cb1b042b585f45b6eb0f453ce))

#### git

- attribute precomposed config and retain managed ignored files
  ([add1efe](https://github.com/hugojosefson/cli/commit/add1efea5f81e6896203f756294a72828dfd0520))
- attribute initial README license sections to their feature
  ([cd6100a](https://github.com/hugojosefson/cli/commit/cd6100a14b186df46b9b3c0754a32abfcb8017c4))
- keep private indexes in the repository Git directory
  ([4db3326](https://github.com/hugojosefson/cli/commit/4db3326492b9487ea788505bc84c278b1fbaad32))

### Other

#### features

- isolate final tasks during fixture setup
  ([a0b67e2](https://github.com/hugojosefson/cli/commit/a0b67e2d3e3b5ae2e3a78f60edca5520d2f7756e))
- verify final checks and separate config commits together
  ([e1a19ac](https://github.com/hugojosefson/cli/commit/e1a19acba4288ba30f0a84f38ce9c62b513f7807))

## 0.4.0

### Features

- manage generated-file Git exclusions
  ([8bd6682](https://github.com/hugojosefson/cli/commit/8bd66821344841c16713b7f56b806112c7469881))

#### deno-test

- report fresh coverage after every test run
  ([0bc286d](https://github.com/hugojosefson/cli/commit/0bc286d0ba9f1946cf1421e1bed0f401945729c4))

#### package

- resolve identity across generated content
  ([9c3255e](https://github.com/hugojosefson/cli/commit/9c3255ec23c7f80731d3c5bc9d5310309a99d363))

### Other

#### features

- validate combined Todo changes and record issue workflow
  ([e3aefff](https://github.com/hugojosefson/cli/commit/e3aefff07d236f32fa1fc56c6c269412b5f7a963))

## 0.3.0

### Features

- add default GitHub projects
  ([2a4d4e7](https://github.com/hugojosefson/cli/commit/2a4d4e78796ccc2289bfa1639e50930e1e42646b),
  [#33](https://github.com/hugojosefson/cli/issues/33))

## 0.2.4

### Fixes

#### deps

- retain supported fork-version release
  ([458eaae](https://github.com/hugojosefson/cli/commit/458eaaed1e0c5bd6c16d2a054b9e66cbb798d2ae))

### Other

- update dependencies
  ([d418712](https://github.com/hugojosefson/cli/commit/d41871215f6e0ad49a0ec5041e08d9d368a514c1))

## 0.2.3

### Fixes

#### features

- preserve workflow pins and explain detected states
  ([debf669](https://github.com/hugojosefson/cli/commit/debf669071766b1f6da1e6cca6fca966429386f6))

## 0.2.2

### Fixes

#### github

- share concurrent feature reads without caching later checks
  ([809c861](https://github.com/hugojosefson/cli/commit/809c8611c9649bb3df517668fd586b46337b1eca))

## 0.2.1

### Fixes

#### cli

- explain the Git prerequisite before feature detection
  ([f714ae1](https://github.com/hugojosefson/cli/commit/f714ae15604bb7af9992300d04cd0bde199f2688))

### Other

- configure repository features
  ([830fd1a](https://github.com/hugojosefson/cli/commit/830fd1ad9fc94c25dab4bcfd29cc827982b24ccd))
- record first publication and prepare registry workflows
  ([14d0a70](https://github.com/hugojosefson/cli/commit/14d0a70a26bb95071fcb0e760a19b8283725a965))
- confirm registry CI and update workflow references
  ([10191b0](https://github.com/hugojosefson/cli/commit/10191b0693b6b6a9bc126d56105d827e0be88165))

## 0.2.0

### Features

- define repository feature contracts
  ([391849a](https://github.com/hugojosefson/cli/commit/391849a3709dd71bc0ee7590da08fb67485068f6))
- resolve repository features
  ([9957bfa](https://github.com/hugojosefson/cli/commit/9957bfa3152954828653ce2877381f4230950a75))
- plan exact artifact changes
  ([050f20a](https://github.com/hugojosefson/cli/commit/050f20adc2ac7c8b3823e964f1d598ab7af5b30b))
- add Git repository feature
  ([d524484](https://github.com/hugojosefson/cli/commit/d524484719227025e20ba9f67d69c4e2170ce2cd))
- read local repository state
  ([47aa8db](https://github.com/hugojosefson/cli/commit/47aa8db7be345df7783d49cf385d7da72570c6f3))
- apply guarded local change plans
  ([e0abd53](https://github.com/hugojosefson/cli/commit/e0abd53462d6bcad68f371d4214da2ff56eed153))
- add static README feature
  ([d347d3b](https://github.com/hugojosefson/cli/commit/d347d3b9f61af419c9da4bad1d6af7271a1a49b9))
- run repository feature commands
  ([8b0e628](https://github.com/hugojosefson/cli/commit/8b0e6281ad6e02bac95a2474314169b86c9a717d))
- repair drifted repository features
  ([3415a09](https://github.com/hugojosefson/cli/commit/3415a0910f2d9d97af04b805426a8c391aefca5d))
- select repository features interactively
  ([7436c7d](https://github.com/hugojosefson/cli/commit/7436c7dc40e5c940b8ec90e93a3c0a6081fdb478))
- add Deno formatting feature
  ([fe801e0](https://github.com/hugojosefson/cli/commit/fe801e05747d3987b75a8ed46ad648a21160e717))
- add Deno library feature
  ([1d0c6bc](https://github.com/hugojosefson/cli/commit/1d0c6bc0a15c3d8370e8169aee176984c265f9ae))
- add Deno CLI feature
  ([070298f](https://github.com/hugojosefson/cli/commit/070298fecd1b746fe86a35ee15a60552f869cc6c))
- add Deno server feature
  ([6de91b1](https://github.com/hugojosefson/cli/commit/6de91b148ad5051dfbcdcc0fe0ae5e02e1fed093))
- add composable Deno task features
  ([95ba5a7](https://github.com/hugojosefson/cli/commit/95ba5a7728d8aac3c934d95ebb560f10b26364c5))
- build generated README content
  ([1e2183e](https://github.com/hugojosefson/cli/commit/1e2183e42c58a11732d53419c72532c9486e9b20))
- confirm warning-bearing feature plans
  ([3a992a5](https://github.com/hugojosefson/cli/commit/3a992a5044a160a32228e258bc0b2caeff3e6510))
- add generated README provider
  ([fcc5836](https://github.com/hugojosefson/cli/commit/fcc5836ed28f511ec0fd919a2a81238659b7cc7b))
- add MIT license provider
  ([2b90c4d](https://github.com/hugojosefson/cli/commit/2b90c4dfd0998d836a0566b98b0b9f4d6da473b1))
- add Apache license provider
  ([cfbd84f](https://github.com/hugojosefson/cli/commit/cfbd84f9940c10fa33f8a338f91b7c33b4d8eeec))
- add common license providers
  ([ab7e961](https://github.com/hugojosefson/cli/commit/ab7e9610fe76a7e9b1ba5e6cab21a87f357b015c))
- link licenses from README files
  ([dd7f150](https://github.com/hugojosefson/cli/commit/dd7f150c7855f2c48f515515b2a59d976a0962ba))
- add weak feature presets
  ([85853f8](https://github.com/hugojosefson/cli/commit/85853f836c2d3463d696b64d65b704cae97d1814))
- manage GitHub repository settings
  ([b24c489](https://github.com/hugojosefson/cli/commit/b24c489d272c12304d7ecb92a456772fdd6ba98a))
- revise GitHub preset defaults
  ([6b0f6a1](https://github.com/hugojosefson/cli/commit/6b0f6a116a5344918491c79853ef3b47fe9968c2))
- add public GitHub preset
  ([6173f04](https://github.com/hugojosefson/cli/commit/6173f044f171baacc48720beec5b584e71912b78))
- add GitHub CI workflows
  ([26190a3](https://github.com/hugojosefson/cli/commit/26190a37d2f4f4b9235f583b7232447c8cea2a2a))
- manage GitHub repository rulesets
  ([9b352df](https://github.com/hugojosefson/cli/commit/9b352df532e602a8a91aba888486182669745955))
- add JSR package configuration
  ([8ef557d](https://github.com/hugojosefson/cli/commit/8ef557db5c077b7d1ccc137088ebf21cc1ea6886))
- add JSR OIDC releases
  ([dc2ab28](https://github.com/hugojosefson/cli/commit/dc2ab284ec9cc3899e03ae51bff448cdd1578485))
- add release publishing and stabilize development workflows
  ([3fd8c7e](https://github.com/hugojosefson/cli/commit/3fd8c7e5548844f7eb0ae45f1b56d6d0e11b6bb9))
- prepare CLI package and verify local installation
  ([f35fc9e](https://github.com/hugojosefson/cli/commit/f35fc9e3e4dcc12890546397af7aad4507119a7c))
- make feature output and documentation easier to scan
  ([90ab7bc](https://github.com/hugojosefson/cli/commit/90ab7bcb01c772bb2040cce579866f1de10d428d))

#### cli

- color feature rows and honor terminal conventions
  ([7398a30](https://github.com/hugojosefson/cli/commit/7398a308f6b345368f3643fc253e8bdb0c7362a9))

#### jsr

- default to member-triggered CI publication
  ([4d9165c](https://github.com/hugojosefson/cli/commit/4d9165ce432a9c96b4c1cb04982f88fc67d42d97))

#### release

- support pinned GitHub CLI sources for first publication
  ([816afd4](https://github.com/hugojosefson/cli/commit/816afd443ca90538990446def86f7aafa3c9170c))

#### server

- generate native serve and development tasks
  ([45d8049](https://github.com/hugojosefson/cli/commit/45d80497494c2bd868599593b05a6153aae36353))

### Fixes

- compose shared directory plans
  ([b4cffe6](https://github.com/hugojosefson/cli/commit/b4cffe6092a588bf939ffd2aafc8121f240d54a6))
- check explicitly requested drift
  ([529d548](https://github.com/hugojosefson/cli/commit/529d5485f93348c1dc3ccb8472343c8a1c0e0147))
- emit formatter-compatible generated files
  ([127cc92](https://github.com/hugojosefson/cli/commit/127cc92d185b723360464d827a6be40adf37a99b))
- inspect large license templates safely
  ([083aa42](https://github.com/hugojosefson/cli/commit/083aa4259702f2a8e53155d783fa89079af89885))
- align release protection with live GitHub behavior
  ([b2462a8](https://github.com/hugojosefson/cli/commit/b2462a8e30c36856be94e115da0577e0993729d9))

#### cli

- report local and GitHub changes independently
  ([b26d19f](https://github.com/hugojosefson/cli/commit/b26d19fdf07169f221a6606d447089106a4305e7))

#### features

- recognize configured projects beyond starter templates
  ([4abb709](https://github.com/hugojosefson/cli/commit/4abb709c62403854f4094f4446c4b67d48c7435e))

#### git

- commit feature files when initializing a repository
  ([3996087](https://github.com/hugojosefson/cli/commit/3996087a09dc1de3fdac13d06d46711f56e7bf53))

#### github

- avoid redundant identity lookups and explain rate limits
  ([9e6393d](https://github.com/hugojosefson/cli/commit/9e6393de668e7b0f81a82c3fcfdcf4793aeb8135))

#### jsr

- publish automatically after release tag creation
  ([ffc6930](https://github.com/hugojosefson/cli/commit/ffc69306ba715519b920ecec5a5cafb9b3e41654))
- verify transformed modules through bound manifest provenance
  ([39a40ec](https://github.com/hugojosefson/cli/commit/39a40ecb48a2ee26da995baaf483f6575f7bf456))
- dispatch publication at the release tag when main advances
  ([c571839](https://github.com/hugojosefson/cli/commit/c57183986d3fe3534b2f8c2568f5224b4d6b4f0a))

#### protection

- accept exact pinned-source CI workflows
  ([2e0a013](https://github.com/hugojosefson/cli/commit/2e0a0138ebeacc3f16d7f32ac80adf4b8bf48097))

#### release

- handle real GitHub Actions publication requirements
  ([3eb7bac](https://github.com/hugojosefson/cli/commit/3eb7bac436ffb72b23d35d822e8f174f85d2add0))
- clean up source collisions before auto-merge
  ([3047ff9](https://github.com/hugojosefson/cli/commit/3047ff91f5776330ceef70cb4972d3cf7cca5848))
- detect draft and duplicate GitHub releases
  ([7a7b8e4](https://github.com/hugojosefson/cli/commit/7a7b8e4556df513d095d6644f293f69130288197))
- confirm delayed publications and accept safe retries
  ([9658b37](https://github.com/hugojosefson/cli/commit/9658b37c81b29ef409f42922322d565712445c3b))

#### server

- grant listener permission in the generated CLI launcher
  ([0e5f5f0](https://github.com/hugojosefson/cli/commit/0e5f5f0bb70d745d3cdd67095268373c7fb79aae))

#### workflows

- keep CLI loading from changing project lockfiles
  ([b967685](https://github.com/hugojosefson/cli/commit/b96768556071b8665f56b209505a35afc87bc8ac))

### Other

- init repo
  ([2dad56c](https://github.com/hugojosefson/cli/commit/2dad56c2c8eaf58e836509c6a55b068f2d254d09))
- readme
  ([fb318e9](https://github.com/hugojosefson/cli/commit/fb318e9f92db67cf57b302d396418e64ff58cbc8))
- add webstorm project config
  ([c82ed56](https://github.com/hugojosefson/cli/commit/c82ed560bdbda55071e47f3e13f939b53c494e0f))
- define planned feature behavior
  ([4550a29](https://github.com/hugojosefson/cli/commit/4550a29141f124b4d0f96675a73331ddf270b686))
- cover terminal input and release cleanup failures
  ([4e6c45b](https://github.com/hugojosefson/cli/commit/4e6c45b154aceefa2318149b7cae319a5a80d073))
- prepare public README and centralize generated package references
  ([c2d8a4b](https://github.com/hugojosefson/cli/commit/c2d8a4bc7f31b0ca6b3fb7d96f3a6b6920e56b2e))
- assess missing git-hj-init behavior
  ([e9158ee](https://github.com/hugojosefson/cli/commit/e9158ee15db84c50757889fbb977c05de0b802a8))
- prepare version 0.1.0 and record live release validation
  ([2498d5a](https://github.com/hugojosefson/cli/commit/2498d5a07e76e5ec38748d3e084bc249c8d9b8e3))
- plan first release through managed features
  ([00c8ab4](https://github.com/hugojosefson/cli/commit/00c8ab498e610e3ac32c27480ba30bb235795486))
- clarify JSR scope security setup
  ([ee38ee3](https://github.com/hugojosefson/cli/commit/ee38ee3525dc294f826bcafce0bd6e067dfc58a7))
- reuse coverage checks in managed CI
  ([9814df0](https://github.com/hugojosefson/cli/commit/9814df07116fa80df223a35fa5579c22faa3b351))
- configure repository features
  ([6b138be](https://github.com/hugojosefson/cli/commit/6b138be00ad802ec3be331b554d487b8c23233bd))
- configure repository features
  ([a0fa274](https://github.com/hugojosefson/cli/commit/a0fa274612092f28ed27b8be1fb2bdffb3c962b3))
- distinguish initial capabilities from published release versions
  ([325af35](https://github.com/hugojosefson/cli/commit/325af35a0b30d8435199ee69fbcd26f462437cb6))
- record public bootstrap validation and authorized release steps
  ([28943ba](https://github.com/hugojosefson/cli/commit/28943ba67267073ce613f82f65a5f4dce525ddd7))
- configure repository features
  ([02e199d](https://github.com/hugojosefson/cli/commit/02e199db665a1def8f4d69f61477b279aec98feb))

#### git-hj-init

- update feature recommendations
  ([7389507](https://github.com/hugojosefson/cli/commit/73895076e8fc69828d90b63481b2e1d2cd5840be))

#### repo-features

- document feature presets and GitHub options
  ([f7c0b8e](https://github.com/hugojosefson/cli/commit/f7c0b8efa1302b2e64faddcfce49d2ed2e04f282))

## Initial capabilities

The initial release includes these capabilities.

| Area             | Included behavior                                                                                                          |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Repository setup | Inspect, enable, disable, and repair declared features.                                                                    |
| Deno projects    | Generate CLI, library, and server projects with standard tasks.                                                            |
| Git              | Initialize repositories and commit the selected generated files.                                                           |
| Documentation    | Manage static or assembled README files and licenses.                                                                      |
| GitHub           | Configure existing repositories, CI, and protection for personal repositories.                                             |
| Releases         | Prepare release PRs, merge by rebase, create tags, and run separate publishers.                                            |
| JSR setup        | Select package and release features with `--jsr`; publish automatically through GitHub Actions after release tag creation. |
| First release    | Load a pinned public GitHub commit with `--workflow-cli`, then migrate generated workflows to JSR.                         |
| Terminal output  | Show structured results in tables with terminal-aware colors.                                                              |

Linux is the supported test platform. The package exposes a CLI, with no
supported library API.

Live GitHub release tests passed in disposable repositories. JSR publication and
installation from JSR are being validated through the first-release pipeline.
See the [validation record](docs/live-validation.md) for evidence and limits.
