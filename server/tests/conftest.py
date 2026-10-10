import os
import sys

# Make the `app` package importable however pytest is invoked (repo root or server/).
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
