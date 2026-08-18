param(
	[string]$Target = "all"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Build-Pkg {
	param(
		[Parameter(Mandatory = $true)]
		[string]$Dir
	)

	$name = Split-Path -Leaf $Dir
	Write-Host ("[build] {0,-24}" -f $name) -NoNewline

	Push-Location $Dir
	try {
		& bun run build *> $null
		if ($LASTEXITCODE -eq 0) {
			Write-Host "ok" -ForegroundColor Green
			return
		}

		Write-Host "FAIL" -ForegroundColor Red
		Write-Host "  Re-running with output:"
		& bun run build
		if ($LASTEXITCODE -ne 0) {
			exit $LASTEXITCODE
		}
	}
	finally {
		Pop-Location
	}
}

function Build-Layer0 {
	Build-Pkg "packages/ai"
	Build-Pkg "packages/runtime-telemetry"
	Build-Pkg "packages/agent"
	Build-Pkg "packages/ecosystem-adapter"
	Build-Pkg "packages/action-rpc"
	Build-Pkg "packages/plugins/plugin-sdk"
	Build-Pkg "packages/plugins/plugin-vite"
}

function Build-Layer1 {
	Build-Pkg "packages/coding-agent"
}

function Build-Layer2 {
	Build-Pkg "packages/runtime-core"
	Build-Pkg "packages/runtime-tools"
	Build-Pkg "packages/runtime-storage"
	Build-Pkg "packages/runtime-mcp"
}

function Build-Apps {
	Build-Pkg "apps/cli-app"
}

function Build-Admin {
}

function Build-Libs {
	Build-Layer0
	Build-Layer1
	Build-Layer2
}

function Build-All {
	Build-Libs
	Build-Apps
	Build-Admin
}

switch ($Target.ToLowerInvariant()) {
	"all" { Build-All; break }
	"lib" { Build-Libs; break }
	"libs" { Build-Libs; break }
	"app" { Build-Apps; break }
	"apps" { Build-Apps; break }
	"desktop" { Build-Libs; Build-Apps; break }
	"cli" { Build-Libs; Build-Pkg "apps/cli-app"; break }
	"admin" { Build-Admin; break }
	default {
		Write-Host "Unknown target: $Target" -ForegroundColor Red
		Write-Host "Usage: ./scripts/build.ps1 [all|libs|apps|desktop|cli|admin]"
		exit 1
	}
}

Write-Host ""
Write-Host "Done." -ForegroundColor Green
