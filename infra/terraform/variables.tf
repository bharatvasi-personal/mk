variable "project" {
  type    = string
  default = "mithilakitchen"
}

variable "environment" {
  type    = string
  default = "prod"
}

variable "domain" {
  type        = string
  description = "Apex domain, e.g. mithilakitchen.in"
}

variable "hcloud_token" {
  type      = string
  sensitive = true
}

variable "b2_key_id" {
  type      = string
  sensitive = true
}

variable "b2_application_key" {
  type      = string
  sensitive = true
}

variable "server_type" {
  type    = string
  # 4 vCPU / 8 GB / 160 GB NVMe, ~€14/mo. Comfortably 100x the launch load; the headroom
  # is for branches #2 and #3, not for branch #1.
  default = "cpx31"
}

variable "location" {
  type    = string
  default = "nbg1"
}

variable "data_volume_gb" {
  type    = number
  default = 50
}

variable "ssh_public_keys" {
  type        = map(string)
  description = "name => public key, one per partner who needs server access"
}

variable "ssh_allowed_cidrs" {
  type        = list(string)
  description = "Where SSH may originate. Do not put 0.0.0.0/0 here."
  default     = []
}
