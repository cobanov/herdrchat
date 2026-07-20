// Minimal App Store Connect API client for HerdrChat's TestFlight setup.
// Auth: ES256 JWT signed with the local ASC API key (.p8), no Apple ID / 2FA.
//
// Usage:
//   swift scripts/asc.swift <ISSUER_ID> probe          # report apps / bundleIds / certs
//   swift scripts/asc.swift <ISSUER_ID> ensure-app     # register bundleId + create app if missing
//
// Env overrides: ASC_KEY_ID (default RQ96AFW6H2).
import Foundation
import CryptoKit

let BUNDLE_ID = "dev.herdr.HerdrChat"
let APP_NAME = "HerdrChat"
let APP_SKU = "herdrchat"
let PRIMARY_LOCALE = "en-US"
let TEAM_ID = "6U58AKY6F8"

let args = CommandLine.arguments
guard args.count >= 3 else {
    FileHandle.standardError.write("usage: swift scripts/asc.swift <ISSUER_ID> <probe|ensure-app>\n".data(using: .utf8)!)
    exit(2)
}
let issuerID = args[1]
let cmd = args[2]
let keyID = ProcessInfo.processInfo.environment["ASC_KEY_ID"] ?? "RQ96AFW6H2"
let keyPath = ("~/.appstoreconnect/private_keys/AuthKey_\(keyID).p8" as NSString).expandingTildeInPath

func die(_ msg: String) -> Never {
    FileHandle.standardError.write((msg + "\n").data(using: .utf8)!)
    exit(1)
}

// MARK: - JWT
func base64url(_ data: Data) -> String {
    data.base64EncodedString()
        .replacingOccurrences(of: "+", with: "-")
        .replacingOccurrences(of: "/", with: "_")
        .replacingOccurrences(of: "=", with: "")
}

func makeJWT() -> String {
    guard let pem = try? String(contentsOfFile: keyPath, encoding: .utf8) else {
        die("cannot read API key at \(keyPath)")
    }
    guard let key = try? P256.Signing.PrivateKey(pemRepresentation: pem) else {
        die("cannot parse EC private key from \(keyPath)")
    }
    let header = #"{"alg":"ES256","kid":"\#(keyID)","typ":"JWT"}"#
    let now = Int(Date().timeIntervalSince1970)
    let exp = now + 60 * 15
    let payload = #"{"iss":"\#(issuerID)","iat":\#(now),"exp":\#(exp),"aud":"appstoreconnect-v1"}"#
    let signingInput = base64url(Data(header.utf8)) + "." + base64url(Data(payload.utf8))
    let sig = try! key.signature(for: Data(signingInput.utf8))
    return signingInput + "." + base64url(sig.rawRepresentation)
}

// MARK: - HTTP
struct APIError: Error { let status: Int; let body: String }

func request(_ method: String, _ path: String, body: [String: Any]? = nil) throws -> Any {
    let url = URL(string: "https://api.appstoreconnect.apple.com\(path)")!
    var req = URLRequest(url: url)
    req.httpMethod = method
    req.setValue("Bearer \(makeJWT())", forHTTPHeaderField: "Authorization")
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    if let body { req.httpBody = try JSONSerialization.data(withJSONObject: body) }

    let sem = DispatchSemaphore(value: 0)
    var out: Data?; var resp: URLResponse?; var err: Error?
    URLSession.shared.dataTask(with: req) { d, r, e in
        out = d; resp = r; err = e; sem.signal()
    }.resume()
    sem.wait()
    if let err { throw err }
    let status = (resp as? HTTPURLResponse)?.statusCode ?? -1
    let data = out ?? Data()
    if status < 200 || status >= 300 {
        throw APIError(status: status, body: String(data: data, encoding: .utf8) ?? "")
    }
    return (try? JSONSerialization.jsonObject(with: data)) ?? [:]
}

func dataArray(_ json: Any) -> [[String: Any]] {
    ((json as? [String: Any])?["data"] as? [[String: Any]]) ?? []
}
func attrs(_ item: [String: Any]) -> [String: Any] { (item["attributes"] as? [String: Any]) ?? [:] }

// MARK: - Commands
func probe() {
    print("== App Store Connect probe (issuer \(issuerID.prefix(8))…, key \(keyID)) ==")

    // Apps
    do {
        let json = try request("GET", "/v1/apps?limit=200")
        let apps = dataArray(json)
        let mine = apps.filter { (attrs($0)["bundleId"] as? String) == BUNDLE_ID }
        print("\nApps: \(apps.count) total")
        if let app = mine.first {
            print("  ✓ \(BUNDLE_ID) EXISTS — id \(app["id"] ?? "?"), name \(attrs(app)["name"] ?? "?")")
        } else {
            print("  ✗ \(BUNDLE_ID) NOT found — app record must be created")
        }
    } catch let e as APIError {
        print("\nApps: query failed (\(e.status)) \(e.body.prefix(300))")
    } catch { print("\nApps: \(error)") }

    // Bundle IDs
    do {
        let json = try request("GET", "/v1/bundleIds?limit=200")
        let ids = dataArray(json)
        let mine = ids.first { (attrs($0)["identifier"] as? String) == BUNDLE_ID }
        print("\nBundle IDs: \(ids.count) registered")
        print(mine != nil ? "  ✓ \(BUNDLE_ID) registered on Developer Portal"
                          : "  ✗ \(BUNDLE_ID) not registered (xcodebuild -allowProvisioningUpdates will add it)")
    } catch let e as APIError {
        print("\nBundle IDs: query failed (\(e.status)) \(e.body.prefix(300))")
    } catch { print("\nBundle IDs: \(error)") }

    // Certificates
    do {
        let json = try request("GET", "/v1/certificates?limit=200")
        let certs = dataArray(json)
        let dist = certs.filter { c in
            let t = (attrs(c)["certificateType"] as? String) ?? ""
            return t.contains("DISTRIBUTION")
        }
        print("\nCertificates: \(certs.count) total, \(dist.count) distribution")
        for c in dist { print("  • \(attrs(c)["certificateType"] ?? "?") — \(attrs(c)["displayName"] ?? "?")") }
        if dist.isEmpty { print("  (xcodebuild -allowProvisioningUpdates will create an Apple Distribution cert)") }
    } catch let e as APIError {
        print("\nCertificates: query failed (\(e.status)) \(e.body.prefix(300))")
    } catch { print("\nCertificates: \(error)") }
}

func ensureApp() {
    // 1) Ensure bundle id registered.
    var bundleResourceID: String?
    do {
        let json = try request("GET", "/v1/bundleIds?limit=200")
        bundleResourceID = dataArray(json).first { (attrs($0)["identifier"] as? String) == BUNDLE_ID }?["id"] as? String
    } catch { die("bundleIds query failed: \(error)") }

    if bundleResourceID == nil {
        print("Registering bundle id \(BUNDLE_ID)…")
        let body: [String: Any] = ["data": [
            "type": "bundleIds",
            "attributes": ["identifier": BUNDLE_ID, "name": APP_NAME, "platform": "IOS", "seedId": TEAM_ID],
        ]]
        do {
            let json = try request("POST", "/v1/bundleIds", body: body)
            bundleResourceID = ((json as? [String: Any])?["data"] as? [String: Any])?["id"] as? String
            print("  ✓ registered (id \(bundleResourceID ?? "?"))")
        } catch let e as APIError { die("register bundle id failed (\(e.status)): \(e.body)") }
        catch { die("register bundle id failed: \(error)") }
    } else {
        print("✓ bundle id already registered (id \(bundleResourceID!))")
    }

    // 2) Ensure app record exists.
    do {
        let json = try request("GET", "/v1/apps?limit=200")
        if dataArray(json).contains(where: { (attrs($0)["bundleId"] as? String) == BUNDLE_ID }) {
            print("✓ app record already exists in App Store Connect")
            return
        }
    } catch { die("apps query failed: \(error)") }

    print("Creating app record \(APP_NAME)…")
    let body: [String: Any] = ["data": [
        "type": "apps",
        "attributes": [
            "name": APP_NAME,
            "bundleId": BUNDLE_ID,
            "primaryLocale": PRIMARY_LOCALE,
            "sku": APP_SKU,
        ],
    ]]
    do {
        _ = try request("POST", "/v1/apps", body: body)
        print("  ✓ app record created")
    } catch let e as APIError {
        die("""
        create app failed (\(e.status)): \(e.body)

        If the API forbids app creation on this account, create it once in the UI:
          App Store Connect → Apps → + → New App
          Platform: iOS | Name: \(APP_NAME) | Bundle ID: \(BUNDLE_ID) | SKU: \(APP_SKU) | Language: English
        then re-run the upload.
        """)
    } catch { die("create app failed: \(error)") }
}

// Create an Apple Distribution certificate from a CSR; write the DER cert to
// outPath and print CERT_ID=<id> for the orchestrator to capture.
func createDistCert(csrPath: String, outPath: String) {
    guard let csrPEM = try? String(contentsOfFile: csrPath, encoding: .utf8) else {
        die("cannot read CSR at \(csrPath)")
    }
    // Reuse an existing DISTRIBUTION cert only if its private key is already
    // local (it is not, on this machine) — so always create a fresh one.
    let body: [String: Any] = ["data": [
        "type": "certificates",
        "attributes": ["certificateType": "DISTRIBUTION", "csrContent": csrPEM],
    ]]
    do {
        let json = try request("POST", "/v1/certificates", body: body)
        let data = (json as? [String: Any])?["data"] as? [String: Any] ?? [:]
        let id = data["id"] as? String ?? "?"
        let content = attrs(data)["certificateContent"] as? String ?? ""
        guard let der = Data(base64Encoded: content, options: .ignoreUnknownCharacters) else {
            die("certificate content not decodable")
        }
        try der.write(to: URL(fileURLWithPath: outPath))
        print("✓ created Apple Distribution certificate")
        print("CERT_ID=\(id)")
    } catch let e as APIError { die("create certificate failed (\(e.status)): \(e.body)") }
    catch { die("create certificate failed: \(error)") }
}

// Create an App Store provisioning profile tying the bundle id to the given
// certificate; write the .mobileprovision and print PROFILE_NAME / PROFILE_PATH.
func createProfile(certID: String) {
    var bundleResourceID: String?
    do {
        let json = try request("GET", "/v1/bundleIds?limit=200")
        bundleResourceID = dataArray(json).first { (attrs($0)["identifier"] as? String) == BUNDLE_ID }?["id"] as? String
    } catch { die("bundleIds query failed: \(error)") }
    guard let bid = bundleResourceID else { die("bundle id \(BUNDLE_ID) not registered") }

    let name = "HerdrChat App Store"
    // Remove any stale profile of the same name to avoid a name-collision 409.
    do {
        let json = try request("GET", "/v1/profiles?limit=200")
        for p in dataArray(json) where (attrs(p)["name"] as? String) == name {
            if let pid = p["id"] as? String { _ = try? request("DELETE", "/v1/profiles/\(pid)") }
        }
    } catch { /* best effort */ }

    let body: [String: Any] = ["data": [
        "type": "profiles",
        "attributes": ["name": name, "profileType": "IOS_APP_STORE"],
        "relationships": [
            "bundleId": ["data": ["type": "bundleIds", "id": bid]],
            "certificates": ["data": [["type": "certificates", "id": certID]]],
        ],
    ]]
    do {
        let json = try request("POST", "/v1/profiles", body: body)
        let data = (json as? [String: Any])?["data"] as? [String: Any] ?? [:]
        let content = attrs(data)["profileContent"] as? String ?? ""
        guard let mp = Data(base64Encoded: content, options: .ignoreUnknownCharacters) else {
            die("profile content not decodable")
        }
        let dir = ("~/Library/MobileDevice/Provisioning Profiles" as NSString).expandingTildeInPath
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        let path = "\(dir)/HerdrChat_AppStore.mobileprovision"
        try mp.write(to: URL(fileURLWithPath: path))
        print("✓ created App Store provisioning profile")
        print("PROFILE_NAME=\(name)")
        print("PROFILE_PATH=\(path)")
    } catch let e as APIError { die("create profile failed (\(e.status)): \(e.body)") }
    catch { die("create profile failed: \(error)") }
}

// The team's distribution certificate id (for regenerating the profile).
func distCertID() -> String {
    do {
        let json = try request("GET", "/v1/certificates?limit=200")
        let cert = dataArray(json).first { (attrs($0)["certificateType"] as? String ?? "").contains("DISTRIBUTION") }
        guard let id = cert?["id"] as? String else { die("no distribution certificate found (run dist-signing first)") }
        return id
    } catch { die("certificates query failed: \(error)") }
}

// Enable the Push Notifications capability on the bundle id, then regenerate the
// App Store profile so it carries the entitlement (needed for APNs).
func enablePush() {
    var bid: String?
    do {
        let json = try request("GET", "/v1/bundleIds?limit=200")
        bid = dataArray(json).first { (attrs($0)["identifier"] as? String) == BUNDLE_ID }?["id"] as? String
    } catch { die("bundleIds query failed: \(error)") }
    guard let bundle = bid else { die("bundle id \(BUNDLE_ID) not registered") }

    let body: [String: Any] = ["data": [
        "type": "bundleIdCapabilities",
        "attributes": ["capabilityType": "PUSH_NOTIFICATIONS"],
        "relationships": ["bundleId": ["data": ["type": "bundleIds", "id": bundle]]],
    ]]
    do {
        _ = try request("POST", "/v1/bundleIdCapabilities", body: body)
        print("✓ enabled PUSH_NOTIFICATIONS on \(BUNDLE_ID)")
    } catch let e as APIError {
        if e.status == 409 { print("✓ PUSH_NOTIFICATIONS already enabled") }
        else { die("enable push failed (\(e.status)): \(e.body)") }
    } catch { die("enable push failed: \(error)") }

    createProfile(certID: distCertID())
}

// Create (or fetch) an EXTERNAL beta group with a public join link, so anyone
// with the URL can install from TestFlight without being added by email. The
// link only becomes live once a build passes Beta App Review.
func createPublicGroup() {
    var appID: String?
    do {
        let json = try request("GET", "/v1/apps?limit=200")
        appID = dataArray(json).first { (attrs($0)["bundleId"] as? String) == BUNDLE_ID }?["id"] as? String
    } catch { die("apps query failed: \(error)") }
    guard let aid = appID else { die("app record for \(BUNDLE_ID) not found") }

    // Reuse an existing public-link group if one already exists.
    if let existing = try? request("GET", "/v1/apps/\(aid)/betaGroups?limit=200") {
        for g in dataArray(existing) {
            let a = attrs(g)
            if (a["isInternalGroup"] as? Bool) != true, let link = a["publicLink"] as? String, !link.isEmpty {
                print("✓ public group already exists")
                print("PUBLIC_LINK=\(link)")
                return
            }
        }
    }

    let body: [String: Any] = ["data": [
        "type": "betaGroups",
        "attributes": ["name": "Public Beta", "publicLinkEnabled": true],
        "relationships": ["app": ["data": ["type": "apps", "id": aid]]],
    ]]
    let created: Any
    do {
        created = try request("POST", "/v1/betaGroups", body: body)
    } catch let e as APIError { die("create group failed (\(e.status)): \(e.body)") }
    catch { die("create group failed: \(error)") }

    let data = (created as? [String: Any])?["data"] as? [String: Any] ?? [:]
    let gid = data["id"] as? String
    var link = attrs(data)["publicLink"] as? String
    // The link is often minted a moment after creation — re-fetch once.
    if (link ?? "").isEmpty, let gid, let refetched = try? request("GET", "/v1/betaGroups/\(gid)") {
        link = attrs((refetched as? [String: Any])?["data"] as? [String: Any] ?? [:])["publicLink"] as? String
    }
    print("✓ created external public-link group 'Public Beta'")
    print("PUBLIC_LINK=\(link ?? "(pending — re-run: swift scripts/asc.swift <issuer> public-link)")")
}

// List HerdrChat's builds and their processing/testing state.
func builds() {
    var appID: String?
    do {
        let json = try request("GET", "/v1/apps?limit=200")
        appID = dataArray(json).first { (attrs($0)["bundleId"] as? String) == BUNDLE_ID }?["id"] as? String
    } catch { die("apps query failed: \(error)") }
    guard let aid = appID else { die("app record for \(BUNDLE_ID) not found") }

    do {
        let json = try request("GET", "/v1/builds?filter[app]=\(aid)&limit=10&sort=-uploadedDate&fields[builds]=version,processingState,uploadedDate,expired")
        let items = dataArray(json)
        if items.isEmpty {
            print("No builds registered yet for \(BUNDLE_ID) — Apple is still processing the upload (wait a few minutes, then re-run).")
            return
        }
        print("HerdrChat builds:")
        for b in items {
            let a = attrs(b)
            print("  • build \(a["version"] ?? "?")  state=\(a["processingState"] ?? "?")  uploaded=\(a["uploadedDate"] ?? "?")")
        }
    } catch let e as APIError { die("builds query failed (\(e.status)): \(e.body)") }
    catch { die("builds query failed: \(error)") }
}

switch cmd {
case "probe": probe()
case "builds": builds()
case "ensure-app": ensureApp()
case "create-dist-cert":
    guard args.count >= 5 else { die("usage: create-dist-cert <csr-path> <out-der-path>") }
    createDistCert(csrPath: args[3], outPath: args[4])
case "create-profile":
    guard args.count >= 4 else { die("usage: create-profile <cert-id>") }
    createProfile(certID: args[3])
case "enable-push": enablePush()
case "public-link", "create-public-group": createPublicGroup()
default: die("unknown command: \(cmd)")
}
