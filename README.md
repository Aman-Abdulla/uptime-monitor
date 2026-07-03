# Sleek Uptime Monitor (UptimePulse)

A lightweight, full-stack uptime monitor featuring a FastAPI (Python) backend, a SQLite database, and an elegant React + Vanilla CSS glassmorphic frontend dashboard. The entire application is containerized and orchestrated using Docker Compose.

---

## ⚡ 1-Line Setup

Run the following command in the project root to spin up the backend API, frontend dashboard, and database volume:

```bash
docker compose up --build
```

Once running, access the services locally at:
- **Frontend Dashboard:** `http://localhost:3000`
- **Backend API Docs (Swagger):** `http://localhost:8000/docs`

---

## 🧪 Testing Steps

To verify that the application correctly monitors and distinguishes between **UP** and **DOWN** states, follow these steps in the frontend UI:

1. **Test a Healthy URL (UP State):**
   - In the **Add New Service Target** form, enter:
     - **Target URL:** `https://example.com` or `https://httpstat.us/200`
     - **Display Name:** `Example Site`
   - Click **Add Monitor**.
   - The card will immediately appear and query the status. It should display a green **UP (200)** status badge and show response times (e.g. `120 ms`).
   - The sparkline block will start populating with green bars.

2. **Test an Unreachable or Invalid URL (DOWN State):**
   - In the **Add New Service Target** form, enter:
     - **Target URL:** `https://thisdomainwillneverexist123.com` or `https://httpstat.us/500`
     - **Display Name:** `Broken Target`
   - Click **Add Monitor**.
   - The card will appear and display a red **DOWN** status badge.
   - An **Error Log** box will appear inside the card detailing the exact reason (e.g., `Connection error / DNS resolution failed` or `HTTP Error`).
   - The sparkline block will populate with red bars.

3. **Verify Manual Health Check ("Check Now"):**
   - Click the **Check Now** button on any monitor card.
   - The status badge will change to a yellow **Checking...** state, query the API instantly, and update with the latest metrics without waiting for the 60-second periodic ping background loop.

4. **Verify Database Persistence:**
   - Terminate the container stack with `Ctrl+C` and run `docker compose down`.
   - Start the stack again using `docker compose up`.
   - Refresh `http://localhost:3000` and confirm that all registered URLs and their check history are still present (persisted via the Docker `db_data` volume).

---

## ☁️ Deployment Sketch (Production IaC)

For production, we would replace the local SQLite database with a managed transactional database (like AWS Aurora Serverless PostgreSQL) and deploy the containers to AWS ECS (Fargate) behind an Application Load Balancer.

Below is a brief, hypothetical Terraform configuration block mapping out this cloud topology:

```hcl
# AWS ECS Cluster
resource "aws_ecs_cluster" "app_cluster" {
  name = "uptime-pulse-production"
}

# Managed Serverless PostgreSQL (RDS Aurora)
resource "aws_rds_cluster" "db_cluster" {
  cluster_identifier      = "uptime-pulse-db"
  engine                  = "aurora-postgresql"
  engine_mode             = "serverless"
  database_name           = "uptimedb"
  master_username         = "dbadmin"
  master_password         = var.db_password
  backup_retention_period = 7
  
  scaling_configuration {
    auto_pause               = true
    max_capacity             = 4
    min_capacity             = 1
    seconds_until_auto_pause = 3600
  }
}

# ECS Fargate Tasks (Backend API + Background Pinger)
resource "aws_ecs_task_definition" "backend_task" {
  family                   = "uptime-backend"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "256"
  memory                   = "512"

  container_definitions = jsonencode([{
    name      = "backend"
    image     = "${var.aws_account_id}.dkr.ecr.${var.aws_region}.amazonaws.com/uptime-backend:latest"
    essential = true
    portMappings = [{
      containerPort = 8000
      hostPort      = 8000
    }]
    environment = [
      { name = "DATABASE_URL", value = "postgresql://${aws_rds_cluster.db_cluster.master_username}:${var.db_password}@${aws_rds_cluster.db_cluster.endpoint}/uptimedb" }
    ]
  }])
}

# ECS Fargate Tasks (Frontend Static Nginx Server)
resource "aws_ecs_task_definition" "frontend_task" {
  family                   = "uptime-frontend"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "256"
  memory                   = "512"

  container_definitions = jsonencode([{
    name      = "frontend"
    image     = "${var.aws_account_id}.dkr.ecr.${var.aws_region}.amazonaws.com/uptime-frontend:latest"
    essential = true
    portMappings = [{
      containerPort = 3000
      hostPort      = 3000
    }]
    environment = [
      { name = "VITE_API_URL", value = "https://api.uptimepulse.example.com" }
    ]
  }])
}

# Application Load Balancer
resource "aws_lb" "app_alb" {
  name               = "uptime-pulse-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb_sg.id]
  subnets            = var.public_subnets
}
```
