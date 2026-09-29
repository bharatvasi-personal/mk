# Infrastructure

```bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars   # fill in tokens, domain, SSH keys
terraform init -backend-config=backend.hcl
terraform plan
terraform apply
```

**Two providers on purpose.** Compute is Hetzner; backups are Backblaze B2. Backups in
the same account as the server are not backups — a suspended account or a compromised
API token takes both.

**`prevent_destroy` is set on the server and the data volume.** A `terraform destroy`
will refuse rather than take the business with it. Removing a branch is a deliberate,
manual act.

**SSH is not open to the world.** Put the partners' addresses in `ssh_allowed_cidrs`. If
that is impractical (dynamic home IPs are common here), use Hetzner's console or a
WireGuard jump host rather than opening port 22.

## Moving to Kubernetes later

`infra/compose/docker-compose.prod.yml` maps 1:1 onto a Helm chart: the app tier is
stateless and 12-factor, health checks and resource limits are already declared, and the
images are tagged by commit SHA. That migration is a deployment change, not an
application change — which is exactly why it can wait until a second tenant or branch #4
makes one box the constraint.
