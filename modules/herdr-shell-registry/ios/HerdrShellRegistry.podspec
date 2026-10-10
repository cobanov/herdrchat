Pod::Spec.new do |s|
  s.name           = 'HerdrShellRegistry'
  s.version        = '1.0.0'
  s.summary        = 'Hands a terminal shell between the SSH module and the terminal view'
  s.description    = 'A dependency-free registry: HerdrSsh delivers a shell channel output here and the HerdrTerminal view attaches to it.'
  s.author         = 'HerdrChat'
  s.homepage       = 'https://herdr.dev'
  s.platforms      = {
    :ios => '17.0'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{swift}"
end
