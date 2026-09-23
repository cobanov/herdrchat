Pod::Spec.new do |s|
  s.name           = 'HerdrKeys'
  s.version        = '1.0.0'
  s.summary        = 'Hardware keyboard shortcuts for the composer'
  s.description    = 'A container view whose UIKeyCommands reach React Native while a text field inside it has focus.'
  s.author         = 'HerdrChat'
  s.homepage       = 'https://herdr.dev'
  s.platforms      = {
    :ios => '17.0'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
