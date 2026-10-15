Pod::Spec.new do |s|
  s.name           = 'HerdrTerminal'
  s.version        = '1.0.0'
  s.summary        = 'A terminal emulator view for a herdr pane'
  s.description    = 'SwiftTerm as an Expo view, fed by the PTY shells of HerdrSsh without crossing the JavaScript bridge.'
  s.author         = 'HerdrChat'
  s.homepage       = 'https://herdr.dev'
  s.platforms      = {
    :ios => '17.0'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  # The shell registry: output of a shell channel in, keystrokes out. Not
  # HerdrSsh itself: importing it would need Citadel's C modules
  # (_AtomicsShims and the NIO shims) on this pod's search paths, which only a
  # target that links the package gets.
  s.dependency 'HerdrShellRegistry'

  # SwiftTerm ships through SPM. Pinned to a release, not a branch or a range.
  # v1.18.0, not the newer 1.19/1.20: those run a build-tool plugin on the
  # SwiftTerm target (SwiftTermBuildInfoPlugin), and Xcode refuses to run an
  # untrusted package plugin outside its UI ("Validate plug-in ... failed"),
  # so `expo run:ios` and any CI build would need -skipPackagePluginValidation.
  # 1.99 is the 2.0 preview with a new I/O layer.
  spm_dependency(s,
    url: 'https://github.com/migueldeicaza/SwiftTerm.git',
    requirement: { kind: 'exactVersion', version: '1.18.0' },
    products: ['SwiftTerm']
  )

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
