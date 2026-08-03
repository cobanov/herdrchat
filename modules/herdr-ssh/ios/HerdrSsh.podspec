Pod::Spec.new do |s|
  s.name           = 'HerdrSsh'
  s.version        = '1.0.0'
  s.summary        = 'SSH transport for reaching herdr hosts over Tailscale'
  s.description    = 'Wraps Citadel (SwiftNIO SSH) so React Native can run commands on, and tail files from, a herdr host.'
  s.author         = 'HerdrChat'
  s.homepage       = 'https://herdr.dev'
  s.platforms      = {
    :ios => '17.0'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Citadel ships only through SPM. React Native's spm_dependency helper
  # (available since RN 0.75, and loaded by the generated Podfile) wires the
  # package into the Pods project so the Swift sources below can import it.
  spm_dependency(s,
    url: 'https://github.com/orlandos-nl/Citadel.git',
    requirement: { kind: 'upToNextMajorVersion', minimumVersion: '0.12.1' },
    products: ['Citadel']
  )

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
