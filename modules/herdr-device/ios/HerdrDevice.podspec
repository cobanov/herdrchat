Pod::Spec.new do |s|
  s.name           = 'HerdrDevice'
  s.version        = '1.0.0'
  s.summary        = 'The device model, including on a simulator'
  s.description    = 'The hardware model identifier (iPhone19,4), which says whether this iPhone unfolds.'
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
