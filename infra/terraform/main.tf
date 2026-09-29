# One VPS, one firewall, DNS, and a backup bucket at a *different* provider.
#
# Hetzner for compute because €14/month buys 4 vCPU and 8 GB, which is roughly 100× what
# one shop at 100 orders a day needs — the headroom is for branch #2 and #3, not for now.
#
# Backblaze B2 for backups because backups must not live in the same account as the thing
# they protect. A compromised or suspended Hetzner account should not take the data with it.

terraform {
  required_version = ">= 1.6"
  required_providers {
    hcloud = { source = "hetznercloud/hcloud", version = "~> 1.48" }
    b2     = { source = "Backblaze/b2", version = "~> 0.8" }
  }

  # Remote state so the DevOps partner is not the single point of failure for it.
  # Configure with: terraform init -backend-config=backend.hcl
  backend "s3" {}
}

provider "hcloud" { token = var.hcloud_token }
provider "b2" {
  application_key_id = var.b2_key_id
  application_key    = var.b2_application_key
}

resource "hcloud_ssh_key" "partners" {
  for_each   = var.ssh_public_keys
  name       = each.key
  public_key = each.value
}

resource "hcloud_firewall" "app" {
  name = "${var.project}-app"

  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "22"
    # SSH is restricted to the partners' addresses. Port 22 open to the world is how a
    # ₹14/day server becomes someone else's crypto miner.
    source_ips = var.ssh_allowed_cidrs
  }

  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "80"
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "443"
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  rule {
    direction  = "in"
    protocol   = "udp"
    port       = "443"
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  # Postgres, Redis and object storage are NOT here on purpose: they are reachable only
  # on the Docker network. Nothing stateful is exposed to the internet.
}

resource "hcloud_server" "app" {
  name        = "${var.project}-${var.environment}"
  image       = "ubuntu-24.04"
  server_type = var.server_type
  # Nuremberg: Hetzner has no Indian region, and ~140 ms to Hyderabad is imperceptible
  # for a POS that is offline-first anyway. Move to AWS ap-south-1 if latency ever shows.
  location    = var.location

  ssh_keys     = [for k in hcloud_ssh_key.partners : k.id]
  firewall_ids = [hcloud_firewall.app.id]

  user_data = templatefile("${path.module}/cloud-init.yaml", {
    project = var.project
  })

  labels = {
    project     = var.project
    environment = var.environment
  }

  lifecycle {
    # The data volume lives on this server. Never let a plan quietly replace it.
    prevent_destroy = true
  }
}

resource "hcloud_volume" "data" {
  name      = "${var.project}-data"
  size      = var.data_volume_gb
  server_id = hcloud_server.app.id
  automount = true
  format    = "ext4"

  lifecycle { prevent_destroy = true }
}

resource "hcloud_rdns" "app_v4" {
  server_id  = hcloud_server.app.id
  ip_address = hcloud_server.app.ipv4_address
  dns_ptr    = var.domain
}

# Versioned, lifecycle-managed, in a different provider from the compute.
resource "b2_bucket" "backups" {
  bucket_name = "${var.project}-backups"
  bucket_type = "allPrivate"

  lifecycle_rules {
    file_name_prefix              = "postgres/"
    days_from_uploading_to_hiding = 35
    days_from_hiding_to_deleting  = 1
  }
}

resource "b2_application_key" "backup_writer" {
  key_name     = "${var.project}-backup-writer"
  bucket_id    = b2_bucket.backups.id
  # Write and list only. The server cannot delete its own backup history, so
  # ransomware on the box cannot erase the way back.
  capabilities = ["listBuckets", "listFiles", "readFiles", "writeFiles"]
}

output "server_ipv4" { value = hcloud_server.app.ipv4_address }
output "server_ipv6" { value = hcloud_server.app.ipv6_address }
output "backup_bucket" { value = b2_bucket.backups.bucket_name }
output "next_steps" {
  value = <<-EOT
    1. Point ${var.domain} and www.${var.domain} at ${hcloud_server.app.ipv4_address}
    2. scp .env to /opt/${var.project}/.env (chmod 600)
    3. ssh root@${hcloud_server.app.ipv4_address} 'cd /opt/${var.project} && make deploy'
    4. make restore-verify   <- do this BEFORE the shop opens, not after
  EOT
}
