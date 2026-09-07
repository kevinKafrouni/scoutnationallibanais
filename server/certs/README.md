# Supabase certificate authority

`supabase-ca.crt` is a public CA certificate, not a private key. It was downloaded over HTTPS from the certificate URL used by Supabase's dashboard:

https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt

Source: https://github.com/supabase/supabase/blob/master/apps/studio/hooks/custom-content/custom-content.json

The application adds this certificate to Node's standard trust roots only for Supabase database hosts. Certificate and hostname verification remain enabled. `DATABASE_SSL_CA` can override the CA bundle when Supabase rotates certificates or a project uses a different CA.
