`ipaghazi` is a web service for over-the-air (OTA) distribution of iOS apps.

## Use cases

- You develop in-house apps for a team and would like to provide an easy way to
  browse and install them.

- Beta testing?

## What it does

- CRUD (seriously) API for publishing app builds.

- Basic web frontend for browsing and installing apps on client devices.

## What it doesn't do

- **Non-terrible security or access control. Don't use this in a mission-critical
  context!**

- HTTPS. Use a reverse proxy.

- Useful error messages.

- Anything related to provisioning profiles or code signing. IPAs are served
  as-is. This will present problems if an IPA becomes invalid due to e.g.
  signing certificate expiration.

  `ipaghazi` can serve any `.ipa`, but iOS will only accept those signed for
  "ad-hoc distribution" or "internal distribution". Of these, internal
  distribution is more convenient because one need not manage UDIDs, but it
  requires paying Apple more money for the requisite signing privileges.

- Accept IPA uploads. Storage is delegated to other services, such as Amazon S3,
  web servers, etc. One uploads the IPA separately and then tells `ipaghazi`
  where to find it.

- Push apps to devices. This is a different meaning of the term "OTA". To push
  apps, you need an iOS mobile device management (MDM) service, such as OS X
  Server's Profile Manager.

## Configuration

`ipaghazi` is configured through environment variables.

- `IPAGHAZI_PORT`: HTTP port. Required.

- `IPAGHAZI_BASEURL`: Where the app is accessible. The API is homed at
  `$IPAGHAZI_BASEURL/api`. Note that `ipaghazi` expects to see the full path;
  the reverse proxy, if any, should not strip off the path prefix. Required.

- `IPAGHAZI_MONGODB`: Where the database is. Something like
  `mongodb://localhost/some-database`. Required.

- `IPAGHAZI_ANON_PERMS`: Implicit permissions for unauthenticated API users and
  the web UI. Optional, but you probably want to set it to `browse-app`.
  Permission names are whitespace-separated.

- `IPAGHAZI_ROOT_USER`: Username for the root API user, which has all
  permissions. If empty, root user is disabled. Optional.

- `IPAGHAZI_ROOT_KEY`: Key for the root API user. If empty, root user is
  disabled. Optional. The key is freeform, but a 64-character hex string is
  recommended:

        LANG=C tr -cd 0-9a-f </dev/urandom | head -c 64

- `IPAGHAZI_METHODS`: Valid IPA retrieval methods. A submitted build may specify
  any method, but the IPA cannot be retrieved unless the method is in this list.
  Method names are whitespace-separated. Optional. By default, no methods are
  valid.

## IPA retrieval methods

### `s3`

Retrieves from an S3 bucket. Takes the following `method-params`:

    {"bucket": "some-s3-bucket",
     "object": "some-object-key"}

To use this method with a non-public bucket, you must arrange to configure the
AWS SDK credentials. In general, setting `AWS_ACCESS_KEY_ID` and
`AWS_SECRET_ACCESS_KEY` should suffice. If you are running on an EC2 instance
with an IAM role, the AWS SDK should automatically pick up credentials.

### `url`

Retrieves from a URL. Takes the following `method-params`:

    {"url": "http://server/some-app.ipa"}

### `file` (do not use)

Retrieves from the local filesystem. Takes the following `method-params`:

    {"path": "/path/to/app.ipa"}

**This method is obviously dangerous, so don't enable it in production.** One
could easily submit a build whose `path` is `/etc/shadow`. Running `curl
http://server/api/build/98eccd9324cb9c674811e65c/ipa` would then dump out all
your password hashes. Oops.

But it's handy for testing.

## Installation

From source:

    npm install
    bower install
    env [...] ./main.js # See Configuration section

With Docker:

   docker build .

## Background

Within organizations, one would often like to distribute internal iOS apps
through the simple means of opening a link to an app file, as is possible with
Android APKs. Of course, this is Apple technology, so the simple solution is out
of the question. Instead we are forced to deal with the unnecessarily
complicated mechanism of over-the-air (OTA) install manifests. The user opens a
link of the form:

    itms-services://?action=download-manifest&url=https://example.org/manifest.plist

Note the conspicuous lack of any IPA files in that link. Instead, one specifies
a URL to a "manifest" which looks like this:

    <?xml version="1.0" encoding="UTF-8"?>
    <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
    <plist version="1.0">
    <dict>
        <key>items</key>
        <array>
            <dict>
                <key>assets</key>
                <array>
                    <dict>
                        <key>kind</key>
                        <string>software-package</string>
                        <key>url</key>
                        <string>https://example.org/someapp.ipa</string>
                    </dict>
                </array>
                <key>metadata</key>
                <dict>
                    <key>bundle-identifier</key>
                    <string>org.example.someapp</string>
                    <key>bundle-version</key>
                    <string>1.0</string>
                    <key>kind</key>
                    <string>software</string>
                    <key>title</key>
                    <string>SomeApp</string>
                </dict>
            </dict>
        </array>
    </dict>
    </plist>

The IPA URL is specified here in addition to the app bundle ID, version, and
name. The manifest is completely redundant as all of this information is
contained within the IPA itself. Moreover, arbitrary constraints have been
applied to this process:

- The manifest and IPA must be served over HTTPS.

- You can't use `file://` URLs. Installing from local storage would be too
  *simple*, you see.

iOS performs installation through a service running in the background. When the
user presses "OK" to allow the install, nothing else happens in the browser, and
one must go to the home screen to observe progress.

Because the manifest hardcodes the URL, it will break if one decides to put the
IPA somewhere else. One must also generate a manifest anew for every build so
that the redundant metadata will match. It would therefore be preferable to
autogenerate the manifest, and for this one needs a backend.

Authentication is also a problem. You can...

- Host apps on your firewalled intranet.

- Require a VPN to access apps.

- Use HTTP Basic Authentication. This works, but the user may need to enter
  credentials three times - once to access the page with the `itms-services://`
  link, once for iOS to download the manifest, and once for the IPA. iOS does
  not remember credentials between contexts.

- Don't restrict access, and just hope nobody finds the URL. What could go
  wrong?

The options for authentication are otherwise limited. You can't use OAuth
because that requires in-browser user interaction, and you can't specify HTTP
headers. You also can't embed a password in the manifest and IPA URLs like
`https://user:password@example.org/...`, because iOS will prefill the username
but ignore the password. Putting credentials in the query string is an option.

`ipaghazi` approaches the problem by making it your problem. You could configure
your HTTPS termination proxy to require Basic authentication for the web
interface (`$IPAGHAZI_BASEURL`) but allow unauthenticated requests to the API
(`$IPAGHAZI_BASEURL/api`). Or you could put the whole thing behind a firewall
and forget about authentication.

## "ipaghazi"?

It's an "IPA gateway".
["-gate"](https://en.wikipedia.org/wiki/Watergate_scandal) is a common suffix
for political scandals, as is now
["-ghazi"](https://en.wikipedia.org/wiki/2012_Benghazi_attack). Thus,
"ipaghazi", an uninspired and unnecessarily provocative play on words.
Suggestions for better names are welcome.

> Hey! You got your politics butter on my software chocolate!

Oops.
