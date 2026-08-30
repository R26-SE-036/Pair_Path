"""Test package.

Puts both this directory and the service root on the import path so the suite
runs the same way from either working directory:

    python -m unittest discover -s tests -t .
    python -m unittest discover -s tests -t tests
"""

import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_ML_ROOT = os.path.dirname(_HERE)

for path in (_HERE, _ML_ROOT):
    if path not in sys.path:
        sys.path.insert(0, path)
