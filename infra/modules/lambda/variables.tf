variable "function_name" {
  type = string
}

variable "timeout" {
  type    = number
  default = 30
}

variable "memory_size" {
  type    = number
  default = 512
}

variable "package_type" {
  type    = string
  default = "Zip"
}

variable "filename" {
  type    = string
  default = null
}

variable "handler" {
  type    = string
  default = null
}

variable "runtime" {
  type    = string
  default = null
}

variable "source_code_hash" {
  type    = string
  default = null
}

variable "image_uri" {
  type    = string
  default = null
}

variable "reserved_concurrency" {
  type    = number
  default = -1
}

variable "environment_variables" {
  type    = map(string)
  default = {}
}
